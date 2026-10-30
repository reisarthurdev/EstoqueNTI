import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

const conn = await mysql.createConnection({
  host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, multipleStatements: true,
});

await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
await conn.query(`USE \`${DB_NAME}\``);
await conn.query(readFileSync(join(import.meta.dirname, '../db/schema.sql'), 'utf8'));

// Migração: bancos criados em versões antigas não têm movements.location_id
const [[{ found }]] = await conn.query(
  `SELECT COUNT(*) AS found FROM information_schema.columns
   WHERE table_schema = ? AND table_name = 'movements' AND column_name = 'location_id'`,
  [DB_NAME],
);
if (!found) {
  await conn.query(`ALTER TABLE movements
    ADD COLUMN location_id INT UNSIGNED NULL AFTER user_id,
    ADD CONSTRAINT fk_movements_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL`);
}

// Migração: status "indisponivel" e quantidade nunca negativa
const [[{ statusType }]] = await conn.query(
  `SELECT column_type AS statusType FROM information_schema.columns
   WHERE table_schema = ? AND table_name = 'equipments' AND column_name = 'status'`,
  [DB_NAME],
);
if (!statusType.includes('indisponivel')) {
  await conn.query(`ALTER TABLE equipments MODIFY status
    ENUM('disponivel','em_uso','manutencao','baixado','indisponivel') NOT NULL DEFAULT 'disponivel'`);
}
const [[{ hasCheck }]] = await conn.query(
  `SELECT COUNT(*) AS hasCheck FROM information_schema.table_constraints
   WHERE table_schema = ? AND table_name = 'equipments' AND constraint_name = 'chk_equipments_quantity'`,
  [DB_NAME],
);
if (!hasCheck) {
  await conn.query('UPDATE equipments SET quantity = 0 WHERE quantity < 0');
  await conn.query('ALTER TABLE equipments ADD CONSTRAINT chk_equipments_quantity CHECK (quantity >= 0)');
}
// Regra: quantidade 0 = Indisponível (exceto baixado); voltou a ter saldo = Disponível
await conn.query(`UPDATE equipments SET status = 'indisponivel' WHERE quantity = 0 AND status NOT IN ('baixado', 'indisponivel')`);
await conn.query(`UPDATE equipments SET status = 'disponivel' WHERE quantity > 0 AND status = 'indisponivel'`);

const categories = ['Notebook', 'Desktop', 'Monitor', 'Periférico', 'Rede', 'Impressora', 'Cabo e adaptador', 'Consumível', 'Licença de software'];
await conn.query('INSERT IGNORE INTO categories (name) VALUES ?', [categories.map(n => [n])]);
const locations = ['Almoxarifado NTI', ...readFileSync(join(import.meta.dirname, '../db/locais.txt'), 'utf8').split(/\r?\n/)]
  .map(name => name.trim())
  .filter(Boolean);
await conn.query('INSERT IGNORE INTO locations (name) VALUES ?', [locations.map(name => [name])]);
// O primeiro admin só é criado se ADMIN_EMAIL e ADMIN_PASSWORD estiverem definidos (depois do 1º uso pode removê-los).
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  await conn.query(
    'INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [ADMIN_NAME || 'Administrador', ADMIN_EMAIL, await bcrypt.hash(ADMIN_PASSWORD, 12), 'admin'],
  );
}

await conn.end();
console.log(`Banco pronto.${ADMIN_EMAIL && ADMIN_PASSWORD ? ` Login: ${ADMIN_EMAIL}` : ' Nenhum admin criado (ADMIN_EMAIL/ADMIN_PASSWORD não definidos).'}`);
