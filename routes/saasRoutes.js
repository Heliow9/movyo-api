const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const controller = require('../controllers/saasController');

function authSaas(req,res,next){
  try {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ mensagem:'Token SaaS não informado.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'movyo-dev-secret');
    if (payload?.tipo !== 'saas-admin') return res.status(403).json({ mensagem:'Acesso SaaS não autorizado.' });
    req.saasAdmin = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ mensagem:'Token SaaS inválido ou expirado.' });
  }
}

router.post('/login', controller.login);
router.post('/seed-admin', controller.seedAdmin);
router.post('/seed-planos', authSaas, controller.seedPlanos);

router.get('/overview', authSaas, controller.overview);
router.get('/saude-api', authSaas, controller.saudeApi);
router.get('/erros-api', authSaas, controller.errosApi);
router.get('/relatorios/vendas', authSaas, controller.relatorioVendas);
router.get('/operacao', authSaas, controller.operacao);
router.get('/restaurantes/:id/detalhes', authSaas, controller.detalheRestaurante);
router.get('/restaurantes/:id/status-bot', authSaas, controller.statusBotRestaurante);
router.post('/restaurantes/:id/resetar-senha', authSaas, controller.resetarSenhaRestaurante);
router.put('/restaurantes/:id/email-cobranca', authSaas, controller.atualizarEmailCobranca);
router.post('/restaurantes/:id/bloquear', authSaas, controller.bloquearRestaurante);
router.post('/restaurantes/:id/ativar', authSaas, controller.ativarRestaurante);
router.delete('/restaurantes/:id', authSaas, controller.excluirRestaurante);
router.get('/admins', authSaas, controller.listarAdmins);
router.post('/admins', authSaas, controller.salvarAdmin);
router.put('/admins/:id', authSaas, controller.salvarAdmin);
router.get('/planos', authSaas, controller.listarPlanos);
router.post('/planos', authSaas, controller.salvarPlano);
router.put('/planos/:codigo', authSaas, controller.salvarPlano);
router.get('/restaurantes', authSaas, controller.listarRestaurantes);
router.post('/restaurantes', authSaas, controller.criarRestaurante);
router.put('/restaurantes/:id', authSaas, controller.atualizarRestaurante);
router.post('/restaurantes/:id/liberar-teste', authSaas, controller.liberarTeste);
router.post('/restaurantes/:id/liberar-plano', authSaas, controller.liberarPlano);

module.exports = router;
