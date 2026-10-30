const BOM = '\uFEFF';

/** Escapa a célula e neutraliza fórmulas (=, +, -, @) que o Excel executaria. */
const cell = value => {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** CSV em UTF-8 com BOM e ponto e vírgula, para abrir direto no Excel pt-BR. */
export const toCsv = (headers, rows) =>
  BOM + [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n');
