const express = require("express");
const axios = require("axios");
const router = express.Router();

const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");

const PIX_TTL_MS = 15 * 60 * 1000;
const PAID_STATUSES = new Set(["approved", "accredited", "paid", "pago"]);
const PENDING_ORDER_STATUSES = new Set(["aguardando_pagamento", "pendente"]);
const PENDING_PAYMENT_STATUSES = new Set(["pending", "in_process", "authorized", "pendente", "aguardando_pagamento"]);

function getPedidoId(pedido) {
  return String(pedido?._id || pedido?.id || "");
}

function getRestauranteId(pedido) {
  return pedido?.restaurante?._id || pedido?.restaurante || pedido?.restauranteId || null;
}

function getCreatedAtMs(pedido) {
  const raw = pedido?.criadoEm || pedido?.created_at || pedido?.createdAt || pedido?.dataCriacao;
  const ms = raw ? new Date(raw).getTime() : Date.now();
  return Number.isFinite(ms) ? ms : Date.now();
}

function isPixPedido(pedido) {
  const fp = String(pedido?.formaPagamento || pedido?.formadePagamento || "").toLowerCase();
  return fp.includes("pix");
}

function isPaidStatus(status) {
  return PAID_STATUSES.has(String(status || "").toLowerCase());
}

function isPendingPedido(pedido) {
  const st = String(pedido?.status || "").toLowerCase();
  const sp = String(pedido?.statusPagamento || "").toLowerCase();
  return PENDING_ORDER_STATUSES.has(st) || PENDING_PAYMENT_STATUSES.has(sp);
}

function getMpToken(restaurante) {
  return (
    restaurante?.mercadoPago?.access_token ||
    restaurante?.mercadoPago?.accessToken ||
    restaurante?.mpAccessToken ||
    restaurante?.mercadoPagoAccessToken ||
    process.env.MP_ACCESS_TOKEN ||
    ""
  );
}

async function salvarPedido(pedido) {
  if (typeof pedido.save === "function") return pedido.save();
  return pedido;
}

async function consultarMercadoPago(pedido) {
  if (!pedido?.mpPaymentId) return null;
  const restauranteId = getRestauranteId(pedido);
  const restaurante = restauranteId ? await Restaurante.findById(restauranteId) : null;
  const accessToken = getMpToken(restaurante);
  if (!accessToken) return null;

  const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${pedido.mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

async function normalizarStatusPix(pedido, { consultarMp = true } = {}) {
  if (!pedido) return pedido;

  const statusPagamentoAtual = String(pedido.statusPagamento || "").toLowerCase();
  const jaPago = isPaidStatus(statusPagamentoAtual);

  if (consultarMp && isPixPedido(pedido) && pedido.mpPaymentId && !jaPago) {
    try {
      const mp = await consultarMercadoPago(pedido);
      const mpStatus = String(mp?.status || "").toLowerCase();
      if (mpStatus) {
        pedido.mpStatusDetail = mp?.status_detail || pedido.mpStatusDetail || null;
        if (isPaidStatus(mpStatus)) {
          const agora = new Date();
          pedido.statusPagamento = "pago";
          if (PENDING_ORDER_STATUSES.has(String(pedido.status || "").toLowerCase())) {
            pedido.status = "em_producao";
          }
          pedido.pagoEm = pedido.pagoEm || agora;
          pedido.valorPago = Number(pedido.total || pedido.valorTotal || 0);
          pedido.valorPendente = 0;
          pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
          if (!pedido.pagamentos.some((p) => String(p.mpPaymentId || "") === String(pedido.mpPaymentId || ""))) {
            pedido.pagamentos.push({
              metodo: "pix",
              valor: Number(pedido.total || pedido.valorTotal || 0),
              status: "confirmado",
              recebidoEm: agora,
              mpPaymentId: pedido.mpPaymentId,
              mpStatus,
            });
          }
          await salvarPedido(pedido);
          return pedido;
        }
        pedido.statusPagamento = mpStatus === "pending" ? "pendente" : mpStatus;
        await salvarPedido(pedido);
      }
    } catch (err) {
      console.warn("Não foi possível consultar Mercado Pago no status público:", err?.response?.data || err?.message || err);
    }
  }

  const createdAt = getCreatedAtMs(pedido);
  const expiresAt = createdAt + PIX_TTL_MS;
  const expirado = Date.now() >= expiresAt;

  if (isPixPedido(pedido) && expirado && !isPaidStatus(pedido.statusPagamento) && isPendingPedido(pedido)) {
    pedido.status = "cancelado";
    pedido.statusPagamento = "expirado";
    pedido.canceladoEm = pedido.canceladoEm || new Date();
    await salvarPedido(pedido);
  }

  return pedido;
}

function serializePedido(pedido) {
  const createdAt = getCreatedAtMs(pedido);
  const expiresAt = createdAt + PIX_TTL_MS;
  const pago = isPaidStatus(pedido?.statusPagamento);
  const pixQrCode = pedido?.pixQrCode || pedido?.pixCopiaECola || pedido?.qrCode || "";
  const pixQrCodeBase64 = pedido?.pixQrCodeBase64 || pedido?.qrCodeBase64 || "";

  return {
    ...(typeof pedido?.toObject === "function" ? pedido.toObject() : pedido),
    _id: getPedidoId(pedido),
    pedidoId: getPedidoId(pedido),
    status: pedido?.status,
    statusPagamento: pedido?.statusPagamento,
    pago,
    pixQrCode,
    pixQrCodeBase64,
    pixExpiresAt: expiresAt,
    pixTimeLeftMs: Math.max(0, expiresAt - Date.now()),
  };
}

router.get("/pedidos/:telefone", async (req, res) => {
  const telefone = String(req.params.telefone || "").replace(/\D/g, "");
  const restauranteId = req.query.restauranteId || req.query.restaurante || req.query.lojaId || null;

  try {
    if (!telefone || telefone.length < 8) {
      return res.status(400).json({ message: "Telefone inválido." });
    }

    const filtro = { telefoneCliente: telefone };
    if (restauranteId) filtro.restaurante = restauranteId;

    const pedidos = await Pedido.find(filtro).sort({ criadoEm: -1 });
    const normalizados = [];
    for (const pedido of pedidos || []) {
      normalizados.push(serializePedido(await normalizarStatusPix(pedido, { consultarMp: true })));
    }

    return res.status(200).json({ pedidos: normalizados });
  } catch (err) {
    console.error("Erro ao buscar pedidos do cliente:", err);
    return res.status(500).json({ message: "Erro ao buscar pedidos do cliente", error: err.message });
  }
});

router.post("/pedidos/:pedidoId/cancelar-pix", async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    await normalizarStatusPix(pedido, { consultarMp: true });

    if (isPaidStatus(pedido.statusPagamento)) {
      return res.status(409).json({ message: "Este pedido já foi pago e não pode ser cancelado pela vitrine.", pedido: serializePedido(pedido) });
    }

    if (String(pedido.status || "").toLowerCase() === "cancelado") {
      return res.json({ ok: true, message: "Pedido já estava cancelado.", pedido: serializePedido(pedido) });
    }

    pedido.status = "cancelado";
    pedido.statusPagamento = "cancelado";
    pedido.canceladoEm = pedido.canceladoEm || new Date();
    await salvarPedido(pedido);

    return res.json({ ok: true, message: "Pix cancelado.", pedido: serializePedido(pedido) });
  } catch (err) {
    console.error("Erro ao cancelar Pix público:", err);
    return res.status(500).json({ message: "Erro ao cancelar Pix.", error: err.message });
  }
});

async function statusPublicoPedido(req, res) {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const normalizado = await normalizarStatusPix(pedido, { consultarMp: true });
    const data = serializePedido(normalizado);

    return res.json({
      pedidoId: data.pedidoId,
      status: data.status,
      statusPagamento: data.statusPagamento,
      payment_status: data.statusPagamento,
      pago: data.pago,
      pixExpiresAt: data.pixExpiresAt,
      pixTimeLeftMs: data.pixTimeLeftMs,
      pixQrCode: data.pixQrCode,
      pixQrCodeBase64: data.pixQrCodeBase64,
    });
  } catch (err) {
    console.error("Erro ao consultar status público do pedido:", err?.response?.data || err);
    return res.status(500).json({ message: "Erro ao consultar status do pedido." });
  }
}

// Compatibilidade com vitrines antigas e rota nova.
router.get("/status/:pedidoId", statusPublicoPedido);
router.get("/mercadopago/pix/status/:pedidoId", statusPublicoPedido);

module.exports = router;
