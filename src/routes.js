import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, tx } from './db.js';
import { allow } from './auth.js';
import { findImage, searchImages } from './images.js';

const STATUSES = ['disponivel', 'em_uso', 'manutencao', 'baixado', 'indisponivel'];
const ROLES = ['admin', 'tecnico', 'leitor'];
const writers = allow('admin', 'tecnico');
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Quantidade 0 = indisponível; voltou a ter saldo = disponível. "Baixado" nunca muda sozinho. */
const syncStatus = (quantity, status) => {
  if (status === 'baixado') return status;
  if (quantity === 0) return 'indisponivel';
  return status === 'indisponivel' ? 'disponivel' : status;
};

export const api = Router();

// ---------- Itens ----------
const opt = max => z.string().trim().max(max).nullish().transform(v => v || null);
const id = z.coerce.number().int().positive().nullish().transform(v => v ?? null);

const equipmentBody = z.object({
  name: z.string().trim().min(2).max(150),
  asset_tag: opt(50),
  serial_number: opt(100),
  brand: opt(80),
  model: opt(80),
  category_id: id,
  location_id: id,
  quantity: z.coerce.number().int().min(0).default(0),
  min_quantity: z.coerce.number().int().min(0).default(0),
  unit_cost: z.coerce.number().min(0).default(0),
  status: z.enum(STATUSES),
  purchase_date: z.string().date().nullish().transform(v => v || null),
  warranty_until: z.string().date().nullish().transform(v => v || null),
  notes: opt(5000),
  image_url: z.string().max(500).startsWith('https://').nullish().transform(v => v || null),
});
// Na edição a quantidade é opcional: se vier e mudar, vira um ajuste no histórico
const updateBody = equipmentBody.extend({ quantity: z.coerce.number().int().min(0).optional() });

const listQuery = z.object({
  q: z.string().trim().optional(),
  category_id: z.coerce.number().int().optional(),
  location_id: z.coerce.number().int().optional(),
  status: z.enum(STATUSES).optional(),
  sort: z.enum(['name', 'quantity', 'updated_at', 'created_at', 'unit_cost']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const FROM = `FROM equipments p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN locations l ON l.id = p.location_id`;

function filters(f) {
  const where = [];
  const params = [];
  if (f.q) {
    where.push('(p.name LIKE ? OR p.asset_tag LIKE ? OR p.serial_number LIKE ? OR p.brand LIKE ? OR p.model LIKE ?)');
    params.push(...Array(5).fill(`%${f.q}%`));
  }
  for (const col of ['category_id', 'location_id', 'status']) {
    if (f[col]) { where.push(`p.${col} = ?`); params.push(f[col]); }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

api.get('/equipments', async (req, res) => {
  const f = listQuery.parse(req.query);
  const { sql, params } = filters(f);
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category, l.name AS location ${FROM} ${sql}
     ORDER BY p.${f.sort} ${f.order} LIMIT ? OFFSET ?`,
    [...params, f.limit, (f.page - 1) * f.limit],
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${sql}`, params);
  res.json({ rows, total, limit: f.limit });
});

api.get('/equipments/images', writers, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
  res.json(await searchImages(q));
});

api.post('/equipments', writers, async (req, res) => {
  const data = equipmentBody.parse(req.body);
  data.status = syncStatus(data.quantity, data.status);
  data.image_url ??= await findImage(data);
  const equipmentId = await tx(async conn => {
    const [{ insertId }] = await conn.query('INSERT INTO equipments SET ?', [data]);
    if (data.quantity > 0) {
      await conn.query('INSERT INTO movements SET ?', [{
        equipment_id: insertId, user_id: req.user.uid, type: 'entrada',
        quantity: data.quantity, balance_after: data.quantity, note: 'Estoque inicial',
      }]);
    }
    return insertId;
  });
  res.status(201).json({ id: equipmentId });
});

api.put('/equipments/:id', writers, async (req, res) => {
  const { quantity, ...fields } = updateBody.parse(req.body);
  fields.image_url ??= await findImage(fields);
  await tx(async conn => {
    const [[current]] = await conn.query('SELECT quantity FROM equipments WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!current) throw httpError(404, 'Item não encontrado');
    fields.status = syncStatus(quantity ?? current.quantity, fields.status);
    await conn.query('UPDATE equipments SET ? WHERE id = ?', [fields, req.params.id]);
    if (quantity !== undefined && quantity !== current.quantity) {
      await applyMovement(conn, req.user.uid, {
        equipment_id: Number(req.params.id), type: 'ajuste', quantity,
        responsible: null, note: 'Ajuste manual na edição', location_id: null,
      });
    }
  });
  res.json({ ok: true });
});

api.delete('/equipments/:id', allow('admin'), async (req, res) => {
  await pool.query('DELETE FROM equipments WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// ---------- Movimentações ----------
const movementBody = z.object({
  equipment_id: z.coerce.number().int().positive(),
  type: z.enum(['entrada', 'saida', 'ajuste']),
  quantity: z.coerce.number().int().min(0),
  responsible: opt(150),
  note: opt(255),
  location_id: id,
}).refine(m => m.type === 'ajuste' || m.quantity > 0, { message: 'Quantidade deve ser maior que zero', path: ['quantity'] });

/** Aplica a movimentação, atualiza o saldo e grava o histórico. Deve rodar dentro de tx(). */
async function applyMovement(conn, userId, m) {
  const [[equipment]] = await conn.query('SELECT quantity, status FROM equipments WHERE id = ? FOR UPDATE', [m.equipment_id]);
  if (!equipment) throw httpError(404, 'Item não encontrado');
  const next = { entrada: equipment.quantity + m.quantity, saida: equipment.quantity - m.quantity, ajuste: m.quantity }[m.type];
  if (next < 0) throw httpError(409, `Estoque insuficiente (saldo atual: ${equipment.quantity})`);
  await conn.query('UPDATE equipments SET quantity = ?, status = ? WHERE id = ?', [next, syncStatus(next, equipment.status), m.equipment_id]);
  await conn.query('INSERT INTO movements SET ?', [{ ...m, user_id: userId, balance_after: next }]);
  return next;
}

api.post('/movements', writers, async (req, res) => {
  const m = movementBody.parse(req.body);
  const balance = await tx(conn => applyMovement(conn, req.user.uid, m));
  res.status(201).json({ quantity: balance });
});

api.get('/movements', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, e.name AS equipment, u.name AS user, l.name AS location
     FROM movements m
     JOIN equipments e ON e.id = m.equipment_id
     JOIN users u ON u.id = m.user_id
     LEFT JOIN locations l ON l.id = m.location_id
     ORDER BY m.id DESC LIMIT 200`,
  );
  res.json(rows);
});

// ---------- Categorias e locais ----------
// Categorias: admin e técnico. Locais: somente admin.
const lookupWriters = { categories: writers, locations: allow('admin') };
for (const table of Object.keys(lookupWriters)) {
  api.get(`/${table}`, async (_req, res) => {
    const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY name`);
    res.json(rows);
  });
  api.post(`/${table}`, lookupWriters[table], async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
    const [{ insertId }] = await pool.query(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
    res.status(201).json({ id: insertId, name });
  });
}

// ---------- Painel ----------
api.get('/dashboard', async (_req, res) => {
  const [[[totals]], [low], [recent]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS equipments FROM equipments WHERE status <> 'baixado'`),
    pool.query(`SELECT id, name, quantity, min_quantity FROM equipments
                WHERE status <> 'baixado' AND quantity <= min_quantity
                ORDER BY quantity - min_quantity LIMIT 10`),
    pool.query(`SELECT m.type, m.quantity AS moved, m.created_at, e.name AS name, e.brand, e.model,
                       e.asset_tag, e.serial_number, e.image_url, e.quantity, e.min_quantity, e.status,
                       c.name AS category, l.name AS location
                FROM movements m
                JOIN equipments e ON e.id = m.equipment_id
                LEFT JOIN categories c ON c.id = e.category_id
                LEFT JOIN locations l ON l.id = e.location_id
                ORDER BY m.id DESC LIMIT 30`),
  ]);
  res.json({ totals, low, recent });
});

// ---------- Usuários (admin) ----------
api.get('/users', allow('admin'), async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role, active FROM users ORDER BY name');
  res.json(rows);
});

api.post('/users', allow('admin'), async (req, res) => {
  const u = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(ROLES),
  }).parse(req.body);
  await pool.query('INSERT INTO users SET ?', [
    { name: u.name, email: u.email, role: u.role, password_hash: await bcrypt.hash(u.password, 12) },
  ]);
  res.status(201).json({ ok: true });
});

api.patch('/users/:id', allow('admin'), async (req, res) => {
  const { active } = z.object({ active: z.coerce.boolean() }).parse(req.body);
  if (Number(req.params.id) === req.user.uid) throw httpError(400, 'Você não pode desativar a si mesmo');
  await pool.query('UPDATE users SET active = ? WHERE id = ?', [active, req.params.id]);
  res.json({ ok: true });
});
