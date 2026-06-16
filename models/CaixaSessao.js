const { defineModel } = require('../lib/mysqlModelFactory');
const defs = require('./_defs');

const CaixaSessao = defineModel('CaixaSessao', defs.CaixaSessao);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

CaixaSessao.setAfterPersistHook((current, previous) => {
  const statusAtual = normalizeStatus(current?.status);
  const statusAnterior = normalizeStatus(previous?.status);
  if (statusAtual !== 'aberto' || statusAnterior === 'aberto') return;

  const caixa = current && typeof current.toObject === 'function' ? current.toObject() : { ...current };
  setImmediate(() => {
    const { notifyCaixaAberto } = require('../services/webPushService');
    notifyCaixaAberto(caixa)
      .then((result) => {
        if (result?.enviados > 0) {
          console.log(`🔔 Push caixa aberto enviado: caixa=${caixa._id || caixa.id} dispositivos=${result.enviados}`);
        }
      })
      .catch((error) => console.error('Erro ao disparar push de caixa aberto:', error?.message || error));
  });
});

module.exports = CaixaSessao;
