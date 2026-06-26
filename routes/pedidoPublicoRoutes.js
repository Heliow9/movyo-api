const express = require('express');
const Pedido = require('../models/Pedido');
const Restaurante = require('../models/Restaurante');
const { planHasFeature } = require('../utils/planRules');

module.exports = (io) => {
  const router = express.Router();

router.get('/acompanhar/:token', async (req, res) => {
  try {
    const pedido = await Pedido.findOne({ 'linkEntrega.token': req.params.token })
      .populate('entregador');

    if (!pedido || !pedido.linkEntrega) {
      return res.status(410).send('Link inválido.');
    }

    if (pedido.status === 'entregue' || Date.now() > pedido.linkEntrega.expiracao) {
      return res.status(410).send('Link expirado ou entrega concluída.');
    }

    const restauranteId = pedido.restaurante || pedido.restauranteId;
    const restaurante = restauranteId ? await Restaurante.findById(restauranteId).lean() : null;
    if (restaurante && !planHasFeature(restaurante, 'deliveryManagement')) {
      return res.status(403).send('Acompanhamento de entrega indisponivel no plano atual.');
    }


    if (Date.now() > pedido.linkEntrega.expiracao) {
      return res.status(410).send('Link expirado.');
    }

    // 🔎 DEBUG FORÇADO
    console.log("📦 Pedido carregado com token:", req.params.token);
    console.log("🧭 latitudeCliente:", pedido.latitudeCliente);
    console.log("🧭 longitudeCliente:", pedido.longitudeCliente);

    // ✅ RESPOSTA COMPLETA COM OS CAMPOS
    // ✅ Retorna tudo corretamente com entregador completo
    const pedidoObj = pedido.toObject();

    return res.json({
      ...pedidoObj,
      entregadorNome: pedido.entregador?.nome || 'Motoboy'
    });



  } catch (err) {
    console.error("❌ Erro em /acompanhar/:token:", err);
    return res.status(500).send("Erro interno ao buscar pedido");
  }
});


  return router;
};
