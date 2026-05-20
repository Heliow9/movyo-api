// routes/mercadoPagoPublicoRoutes.js
const express = require("express");
const router = express.Router();

const Restaurante = require("../models/Restaurante");
const Pedido = require("../models/Pedido");
const { consultarPagamento } = require("../services/mercadoPagoPixService");

function isPaidStatus(status) {
  const st = String(status || "").toLowerCase();
  return st === "approved" || st === "paid" || st === "pago";
}

function isFinalFailStatus(status) {
  const st = String(status || "").toLowerCase();
  return ["rejected", "cancelled", "canceled", "expired", "refunded", "charged_back"].includes(st);
}

function toNumber(value) {
  const n = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

async function consultarStatusPixPublico(req, res) {
  try {
    const { pedidoId } = req.params;

    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) {
      return res.status(404).json({ ok: false, message: "Pedido não encontrado." });
    }

    if (!pedido.mpPaymentId) {
      return res.status(400).json({ ok: false, message: "Pedido não tem pagamento PIX vinculado." });
    }

    const restauranteId = pedido.restaurante?._id || pedido.restaurante;
    const restaurante = await Restaurante.findById(restauranteId);
    const accessToken = restaurante?.mercadoPago?.accessToken;

    if (!accessToken) {
      return res.status(400).json({ ok: false, message: "Restaurante sem token Mercado Pago." });
    }

    const mp = await consultarPagamento({ accessToken, paymentId: pedido.mpPaymentId });
    const mpStatus = String(mp?.status || "").toLowerCase();

    pedido.mpStatusDetail = mp?.status_detail || pedido.mpStatusDetail || null;

    if (isPaidStatus(mpStatus)) {
      pedido.statusPagamento = "pago";
      pedido.status = pedido.status === "cancelado" ? pedido.status : "em_producao";
      pedido.valorPago = toNumber(pedido.valorTotal);
      pedido.valorPendente = 0;
      if (!pedido.pagoEm) pedido.pagoEm = new Date();
    } else if (isFinalFailStatus(mpStatus)) {
      pedido.statusPagamento = mpStatus;
      if (pedido.status !== "cancelado" && pedido.status !== "pago" && pedido.status !== "em_producao") {
        pedido.status = "aguardando_pagamento";
      }
    } else {
      pedido.statusPagamento = mpStatus || pedido.statusPagamento || "pendente";
    }

    await pedido.save();

    req.io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);

    return res.json({
      ok: true,
      pedidoId: String(pedido._id),
      paymentId: String(pedido.mpPaymentId),
      status: mpStatus,
      payment_status: mpStatus,
      statusPagamento: pedido.statusPagamento,
      pedidoStatus: pedido.status,
      pago: isPaidStatus(mpStatus),
      mp,
    });
  } catch (err) {
    console.error("pix status publico error:", err?.mp || err?.response?.data || err);
    return res.status(err?.status || 500).json({
      ok: false,
      message: err?.message || "Erro ao consultar pagamento PIX.",
      mp: err?.mp,
    });
  }
}

// Compat com a vitrine atual se ela chamar /api/publico/status/:pedidoId
router.get("/status/:pedidoId", consultarStatusPixPublico);

// Rota pública correta do Mercado Pago PIX
// Montada como /api/publico/mercadopago/pix/status/:pedidoId
router.get("/pix/status/:pedidoId", consultarStatusPixPublico);

module.exports = router;
