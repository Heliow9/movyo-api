const defs = require('../models/_defs');
let out = ['-- Movyo API MySQL - schema coluna por coluna', '-- Compatível com MySQL 5.6 / utf8mb4', 'SET NAMES utf8mb4;', ''];
for (const [name, def] of Object.entries(defs)) {
  const cols = ['  `id` VARCHAR(24) NOT NULL PRIMARY KEY'];
  for (const [prop, f] of Object.entries(def.fields)) {
    const col = f.column || prop;
    cols.push(`  \`${col}\` ${f.type || 'LONGTEXT'} NULL`);
  }
  cols.push('  `created_at` DATETIME NULL');
  cols.push('  `updated_at` DATETIME NULL');
  out.push(`CREATE TABLE IF NOT EXISTS \`${def.table}\` (\n${cols.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`, '');
  for (const idx of def.indexes || []) out.push(idx + ';');
  out.push('');
}
console.log(out.join('\n'));
