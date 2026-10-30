import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { pool } from './db.js';
import { toCsv } from './csv.js';

// Todas as rotas daqui são exclusivas do admin (a trava fica no server.js).
export const reports = Router();

const EXPORT_LIMIT = 20000;
const TYPE_LABEL = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' };
const stamp = () => new Date().toLocaleDateString('sv-SE');

// "2026-10-07 14:03:11" -> "07/10/2026 14:03"
const brDate = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
// O Excel guarda datas sem fuso: usar os componentes como UTC faz a célula mostrar o mesmo horário.
const excelDate = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19)));

// Fonte única das colunas: CSV e Excel saem iguais.
const COLUMNS = [
  { header: 'Data/hora', width: 18, csv: r => brDate(r.created_at), xlsx: r => excelDate(r.created_at), numFmt: 'dd/mm/yyyy hh:mm' },
  { header: 'Item', width: 36, key: 'equipment' },
  { header: 'Patrimônio', width: 16, key: 'asset_tag' },
  { header: 'Nº de série', width: 18, key: 'serial_number' },
  { header: 'Categoria', width: 18, key: 'category' },
  { header: 'Tipo', width: 10, csv: r => TYPE_LABEL[r.type] },
  { header: 'Quantidade', width: 12, key: 'quantity' },
  { header: 'Saldo após', width: 12, key: 'balance_after' },
  { header: 'Local', width: 32, key: 'location' },
  { header: 'Responsável', width: 24, key: 'responsible' },
  { header: 'Observação', width: 36, key: 'note' },
  { header: 'Usuário', width: 20, key: 'user' },
];
const valueOf = (col, row, kind) => (col[kind] ?? col.csv)?.(row) ?? row[col.key];

const FROM = `FROM movements m
  JOIN equipments e ON e.id = m.equipment_id
  JOIN users u ON u.id = m.user_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN locations l ON l.id = m.location_id`;

const SELECT = `m.id, m.created_at, e.name AS equipment, e.asset_tag, e.serial_number, c.name AS category,
  m.type, m.quantity, m.balance_after, l.name AS location, m.responsible, m.note, u.name AS user`;

const SORTS = { created_at: 'm.id', equipment: 'e.name', type: 'm.type', quantity: 'm.quantity' };

const query = z.object({
  q: z.string().trim().optional(),
  type: z.enum(['entrada', 'saida', 'ajuste']).optional(),
  category_id: z.coerce.number().int().optional(),
  location_id: z.coerce.number().int().optional(),
  user_id: z.coerce.number().int().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: z.enum(Object.keys(SORTS)).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(25),
});

function filters(f) {
  const where = [];
  const params = [];
  if (f.q) {
    where.push(`(e.name LIKE ? OR e.asset_tag LIKE ? OR e.serial_number LIKE ? OR e.brand LIKE ? OR e.model LIKE ?
      OR m.responsible LIKE ? OR m.note LIKE ? OR u.name LIKE ? OR l.name LIKE ?)`);
    params.push(...Array(9).fill(`%${f.q}%`));
  }
  const columns = { type: 'm.type', category_id: 'e.category_id', location_id: 'm.location_id', user_id: 'm.user_id' };
  for (const [key, column] of Object.entries(columns)) {
    if (f[key]) { where.push(`${column} = ?`); params.push(f[key]); }
  }
  if (f.from) { where.push('m.created_at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { where.push('m.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(f.to); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function fetchRows(f, limit, offset) {
  const { sql, params } = filters(f);
  const [rows] = await pool.query(
    `SELECT ${SELECT} ${FROM} ${sql} ORDER BY ${SORTS[f.sort]} ${f.order}, m.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows;
}

async function fetchSummary(f) {
  const { sql, params } = filters(f);
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN m.type = 'entrada' THEN m.quantity END), 0) AS units_in,
       COALESCE(SUM(CASE WHEN m.type = 'saida' THEN m.quantity END), 0) AS units_out,
       COALESCE(SUM(m.type = 'ajuste'), 0) AS adjustments
     ${FROM} ${sql}`,
    params,
  );
  return summary;
}

async function fetchByEquipment(f) {
  const { sql, params } = filters(f);
  const [rows] = await pool.query(
    `SELECT e.name AS equipment, e.asset_tag, COUNT(*) AS moves,
       COALESCE(SUM(CASE WHEN m.type = 'entrada' THEN m.quantity END), 0) AS units_in,
       COALESCE(SUM(CASE WHEN m.type = 'saida' THEN m.quantity END), 0) AS units_out
     ${FROM} ${sql} GROUP BY e.id ORDER BY moves DESC LIMIT 500`,
    params,
  );
  return rows;
}

reports.get('/movements', async (req, res) => {
  const f = query.parse(req.query);
  const [rows, summary] = await Promise.all([fetchRows(f, f.limit, (f.page - 1) * f.limit), fetchSummary(f)]);
  res.json({ rows, summary, limit: f.limit });
});

reports.get('/movements/export.csv', async (req, res) => {
  const rows = await fetchRows(query.parse(req.query), EXPORT_LIMIT, 0);
  const csv = toCsv(COLUMNS.map(c => c.header), rows.map(r => COLUMNS.map(c => valueOf(c, r, 'csv'))));
  res.type('text/csv').attachment(`relatorio-movimentacoes-${stamp()}.csv`).send(csv);
});

reports.get('/movements/export.xlsx', async (req, res) => {
  const f = query.parse(req.query);
  const [rows, summary, byEquipment] = await Promise.all([fetchRows(f, EXPORT_LIMIT, 0), fetchSummary(f), fetchByEquipment(f)]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Estoque NTI';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Movimentações', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  sheet.addRows(rows.map(r => Object.fromEntries(COLUMNS.map((c, i) => [`c${i}`, valueOf(c, r, 'xlsx')]))));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const resume = wb.addWorksheet('Resumo');
  resume.columns = [{ width: 40 }, { width: 16 }, { width: 18 }, { width: 18 }];
  resume.addRows([
    ['Relatório de movimentações - Estoque NTI'],
    [`Gerado em ${new Date().toLocaleString('pt-BR')}`],
    [],
    ['Total de movimentações', summary.total],
    ['Unidades que entraram', summary.units_in],
    ['Unidades que saíram', summary.units_out],
    ['Ajustes', summary.adjustments],
    [],
    ['Por item', 'Movimentações', 'Unidades entrada', 'Unidades saída'],
    ...byEquipment.map(e => [e.asset_tag ? `${e.equipment} (${e.asset_tag})` : e.equipment, e.moves, e.units_in, e.units_out]),
  ]);
  resume.getRow(1).font = { bold: true, size: 14 };
  resume.getRow(9).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-movimentacoes-${stamp()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
