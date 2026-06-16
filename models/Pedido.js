const { defineModel } = require('../lib/mysqlModelFactory');
const defs = require('./_defs');

const Pedido = defineModel('Pedido', defs.Pedido);

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

Pedido.setAfterPersistHook((current, previous) => {
  const statusAtual = normalizeStatus(current?.status);
  const statusAnterior = normalizeStatus(previous?.status);
  if (statusAtual !== 'em_producao' || statusAnterior === 'em_producao') return;

  const pedido = current && typeof current.toObject === 'function' ? current.toObject() : { ...current };
  setImmediate(() => {
    const { notifyPedidoEmProducao } = require('../services/webPushService');
    notifyPedidoEmProducao(pedido)
      .then((result) => {
        if (result?.enviados > 0) {
          console.log(`🔔 Push em_producao enviado: pedido=${pedido._id || pedido.id} dispositivos=${result.enviados}`);
        }
      })
      .catch((error) => console.error('Erro ao disparar push de pedido em produção:', error?.message || error));
  });
});

module.exports = Pedido;
