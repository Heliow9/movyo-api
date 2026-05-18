const { defineModel } = require('../lib/mysqlModelFactory');
const defs = require('./_defs');
const PedidoMesa = defineModel('PedidoMesa', defs.PedidoMesa);
PedidoMesa.prototype.recalcularTotal = function(){ this.valorTotal = (this.itens || []).reduce((t,i)=>t+(Number(i.precoUnitario||0)*Number(i.quantidade||0)),0); };
module.exports = PedidoMesa;
