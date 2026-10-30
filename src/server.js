import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { ZodError } from 'zod';
import { allow, auth, requireAuth } from './auth.js';
import { pool } from './db.js';
import { api } from './routes.js';
import { reports } from './reports.js';

if (!process.env.JWT_SECRET) throw new Error('Defina JWT_SECRET no .env');

const app = express();

// Atrás de um proxy reverso (Caddy, Nginx...) o IP real do cliente vem em X-Forwarded-For.
// TRUST_PROXY=1 = confiar em 1 proxy. Sem isso, o limite de tentativas de login só enxerga o IP do proxy.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy && trustProxy !== '0') {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression()); // gzip/brotli em JS, CSS, HTML e JSON (imagens e .xlsx já vêm comprimidos e são ignorados)
app.use(express.json({ limit: '100kb' }), cookieParser());

// Healthcheck público (usado pelo Docker): confirma que o app responde e que o banco está acessível.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'banco indisponível' });
  }
});

// Contato de suporte mostrado no rodapé. Vem do ambiente (SUPPORT_EMAIL / SUPPORT_PHONE); se vazio, o rodapé não mostra contato.
app.get('/api/config', (_req, res) => {
  res.json({ supportEmail: process.env.SUPPORT_EMAIL || null, supportPhone: process.env.SUPPORT_PHONE || null });
});

app.use('/api/auth', auth);app.use('/api/reports', requireAuth, allow('admin'), reports);
app.use('/api', requireAuth, api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

const publicDir = join(import.meta.dirname, '..', 'public');
app.use(express.static(publicDir));
// Qualquer outro endereço: página 404 própria (e JSON para chamadas que não são de página)
app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'Rota não encontrada' });
  res.status(404).sendFile(join(publicDir, '404.html'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Valor duplicado (patrimônio, e-mail ou nome já cadastrado)' });
  }
  if (['ER_CHECK_CONSTRAINT_VIOLATED', 'ER_CONSTRAINT_FAILED'].includes(err.code)) {
    return res.status(400).json({ error: 'A quantidade não pode ser menor que 0' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Categoria ou local inexistente' });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`Estoque NTI v2.0 em http://localhost:${port}`));

// Encerramento limpo: o Docker envia SIGTERM ao parar ou atualizar o container.
// Para de aceitar conexões, termina o que está em andamento e fecha o pool do banco.
function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));
