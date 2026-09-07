const express = require('express');
const authRestaurante = require('../middlewares/authRestaurante');
const checkPermissao = require('../middlewares/checkPermissao');
const c = require('../controllers/financeiroController');

const router = express.Router();
router.use(authRestaurante);
router.param('restauranteId', (req, res, next, value) => {
  if (String(req.restauranteId) !== String(value)) return res.status(403).json({ code: 'RESTAURANTE_MISMATCH', message: 'Restaurante não autorizado.' });
  next();
});

router.get('/:restauranteId/resumo', checkPermissao('visualizarFinanceiro'), c.resumo);
router.get('/:restauranteId/clientes', checkPermissao('visualizarFinanceiro'), c.listarClientes);
router.post('/:restauranteId/clientes', checkPermissao('gerenciarFinanceiro'), c.salvarCliente);
router.put('/:restauranteId/clientes/:clienteId', checkPermissao('gerenciarFinanceiro'), c.salvarCliente);
router.get('/:restauranteId/clientes/:clienteId/extrato', checkPermissao('visualizarFinanceiro'), c.extratoCliente);
router.get('/:restauranteId/contas', checkPermissao('visualizarFinanceiro'), c.listarContas);
router.post('/:restauranteId/contas', checkPermissao('gerenciarFinanceiro'), c.criarContas);
router.post('/:restauranteId/contas/:contaId/receber', checkPermissao('receberContas'), c.receberConta);
router.post('/:restauranteId/contas/:contaId/cancelar', checkPermissao('gerenciarFinanceiro'), c.cancelarConta);

module.exports = router;
