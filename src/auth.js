import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from './db.js';

const COOKIE = 'nti_token';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 8 * 60 * 60 * 1000,
};

export function requireAuth(req, res, next) {
  let user;
  try {
    user = jwt.verify(req.cookies[COOKIE], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  req.user = user;
  next();
}

export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Sem permissão' });

export const auth = Router();

auth.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  const token = jwt.sign({ uid: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE, token, cookieOptions).json({ name: user.name, role: user.role });
});

auth.post('/logout', (_req, res) => res.clearCookie(COOKIE).status(204).end());

auth.get('/me', requireAuth, (req, res) => res.json({ name: req.user.name, role: req.user.role }));
