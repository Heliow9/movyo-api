const { defineModel } = require('../lib/mysqlModelFactory');
const defs = require('./_defs');

const CaixaSessao = defineModel('CaixaSessao', defs.CaixaSessao);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

CaixaSessao.setAfterPersistHook((current, previous) => {
  const statusAtual = normalizeStatus(current?.status);
  const statusAnterior = normalizeStatus(previous?.status);
  const abriu = statusAtual === 'aberto' && statusAnterior !== 'aberto';
  const fechou = statusAtual === 'fechado' && statusAnterior !== 'fechado';
  if (!abriu && !fechou) return;

  const caixa = current && typeof current.toObject === 'function' ? current.toObject() : { ...current };
  setImmediate(() => {
    const { notifyCaixaAberto, notifyCaixaFechado } = require('../services/webPushService');
    const notify = abriu ? notifyCaixaAberto : notifyCaixaFechado;
    notify(caixa)
      .then((result) => {
        if (result?.enviados > 0) {
          console.log(`🔔 Push caixa aberto enviado: caixa=${caixa._id || caixa.id} dispositivos=${result.enviados}`);
        }
      })
      .catch((error) => console.error(`Erro ao disparar push de caixa ${abriu ? 'aberto' : 'fechado'}:`, error?.message || error));
  });
});

module.exports = CaixaSessao;
