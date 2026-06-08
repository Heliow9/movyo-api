const { defineModel } = require('../lib/mysqlModelFactory');
const defs = require('./_defs');
module.exports = defineModel('CaixaMovimento', defs.CaixaMovimento);
