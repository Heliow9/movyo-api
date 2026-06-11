require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { testConnection } = require('../db/mysql');
const { syncAllModels } = require('../lib/mysqlModelFactory');

const modelsDir = path.resolve(__dirname, '../models');

function loadAllModels() {
  const ignored = new Set(['_defs.js']);
  const files = fs
    .readdirSync(modelsDir)
    .filter((file) => file.endsWith('.js') && !ignored.has(file))
    .sort();

  for (const file of files) {
    const fullPath = path.join(modelsDir, file);
    require(fullPath);
    console.log(`✅ Model carregado: ${file}`);
  }

  console.log(`📦 Total de models carregados: ${files.length}`);
}

(async () => {
  await testConnection();
  loadAllModels();
  await syncAllModels();
  console.log('✅ Tabelas MySQL sincronizadas coluna por coluna com todos os models.');
  process.exit(0);
})().catch((error) => {
  console.error('❌ Erro ao sincronizar MySQL:', error);
  process.exit(1);
});
