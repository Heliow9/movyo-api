// controllers/mercadoPagoWebhookController.js
const crypto = require("crypto");

const Pedido = require("../models/Pedido");
const Mesa = require("../models/mesaModel");
const Restaurante = require("../models/Restaurante");

const { consultarPagamento } = require("../services/mercadoPagoPixService");
const { processarWebhookMensalidade } = require("../services/saasBillingService");
const { enviarMensagem, estaConectado } = require("../utils/bot");
const { getCaixaAberto, vincularPedidoAoCaixa, registrarMovimentoVenda, recalcularCaixa } = require("../services/caixaService");

/**
 * ✅ valida assinatura (opcional)
 * IMPORTANTE: pra funcionar, você precisa capturar rawBody no express.json verify
 */
function verifyMpSignature({ req, rawBody }) {
  const sig = String(req.headers["x-signature"] || "");
  const reqId = String(req.headers["x-request-id"] || "");
  const secret = String(process.env.MP_WEBHOOK_SECRET || "").trim();

  if (!secret) return { ok: true, skipped: true };
  if (!sig || !reqId) return { ok: false, reason: "missing_headers" };

  // x-signature: ts=...,v1=...
  const parts = Object.fromEntries(
    sig.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k.trim(), rest.join("=").trim()];
    })
  );

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, reason: "invalid_x_signature" };

  const manifest = `${ts}.${reqId}.${rawBody}`;
  const digest = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(v1));
    return { ok, reason: ok ? "ok" : "bad_signature" };
  } catch {
    return { ok: false, reason: "compare_failed" };
  }
}

/* -----------------------
   Mesa helpers
-------------------------*/
function finalizarPermanenciaMesa(mesa) {
  const agora = new Date();
  if (mesa.ocupadaDesde) {
    const duracaoSeg = Math.max(
      0,
      Math.floor((agora.getTime() - new Date(mesa.ocupadaDesde).getTime()) / 1000)
    );
    mesa.ultimaPermanenciaSegundos = duracaoSeg;
    mesa.ultimaFechadaEm = agora;
  }
  mesa.ocupadaDesde = null;
}

async function liberarMesa({ mesa, io }) {
  finalizarPermanenciaMesa(mesa);

  mesa.status = "livre";
  mesa.pedidoAtualId = null;

  mesa.sessaoToken = null;
  mesa.sessaoExpiraEm = null;
  mesa.sessaoInicialExpiraEm = null;

  await mesa.save();

  if (io) {
    io.to(`restaurante-${mesa.restauranteId}`).emit("mesaAtualizada", mesa);
    io.to(`mesa-${String(mesa._id)}`).emit("mesaAtualizada", mesa);
  }

  return mesa;
}

/* -----------------------
   Status helpers
-------------------------*/
function isPaidStatus(st) {
  const s = String(st || "").toLowerCase();
  return s === "approved" || s === "paid";
}

function isFinalFailStatus(st) {
  const s = String(st || "").toLowerCase();
  return ["rejected", "cancelled", "canceled", "expired", "refunded", "charged_back"].includes(s);
}

// tolerância pra float
function gteWithEps(a, b, eps = 0.009) {
  return Number(a || 0) + eps >= Number(b || 0);
}

function toNum(v) {
  const n = Number(String(v ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}
function formatBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

async function sincronizarVendaComCaixaAtual({ pedido, pagamento }) {
  const restauranteId = String(pedido?.restaurante?._id || pedido?.restaurante || "");
  if (!restauranteId) return null;

  const caixa = await getCaixaAberto(restauranteId).catch(() => null);
  if (!caixa) return null;

  // O pagamento é o fato gerador financeiro: a venda pertence ao caixa aberto
  // no instante da confirmação, mesmo quando o pedido foi criado antes.
  await vincularPedidoAoCaixa(pedido, caixa, { force: true });
  await pedido.save();

  await registrarMovimentoVenda({ pedido, pagamento, caixa, restauranteId });
  await recalcularCaixa(caixa._id || caixa.id);
  return caixa;
}

async function enviarConfirmacaoWhatsappSePossivel({ pedido, pagamento, total }) {
  const restauranteId = String(pedido?.restaurante || "");
  const numero = String(pagamento?.whatsappPixNumero || pedido?.telefoneCliente || "").replace(/\D/g, "");
  if (!restauranteId || !numero) return;
  if (!estaConectado(restauranteId)) return;

  await enviarMensagem(
    restauranteId,
    numero,
    `✅ *Pagamento confirmado!*\n\nSeu pedido foi confirmado e já foi enviado para produção.\n\n🧾 *Total:* ${formatBRL(total || pedido.valorTotal || pedido.total || 0)}`
  ).catch(() => {});
}


function somaPagamentosConfirmados(pagamentos = []) {
  const arr = Array.isArray(pagamentos) ? pagamentos : [];
  return round2(
    arr.reduce((acc, pg) => {
      if (!pg) return acc;
      const st = String(pg.status || "").toLowerCase(); // ✅ no seu schema é "status"
      if (st !== "confirmado") return acc;
      return acc + toNum(pg.valor);
    }, 0)
  );
}

/**
 * ✅ Define formadePagamento coerente no balcão
 * - 0 confirmados: "pendente"
 * - 1 método confirmado: "pix"|"dinheiro"|"cartao"
 * - 2+ métodos confirmados: "misto"
 */
function setFormaPagamentoFromPagamentos(pedido) {
  const pagos = (Array.isArray(pedido.pagamentos) ? pedido.pagamentos : []).filter(
    (p) => String(p?.status || "").toLowerCase() === "confirmado"
  );

  if (pagos.length === 0) {
    pedido.formadePagamento = pedido.formadePagamento || "pendente";
    return { forma: pedido.formadePagamento, metodos: [] };
  }

  const metodos = [...new Set(pagos.map((p) => String(p?.metodo || "").toLowerCase()).filter(Boolean))];

  if (metodos.length <= 0) {
    pedido.formadePagamento = pedido.formadePagamento || "pendente";
    return { forma: pedido.formadePagamento, metodos: [] };
  }

  if (metodos.length === 1) {
    pedido.formadePagamento = metodos[0]; // "pix" | "dinheiro" | "cartao"
    return { forma: pedido.formadePagamento, metodos };
  }

  pedido.formadePagamento = "misto";
  return { forma: pedido.formadePagamento, metodos };
}

function upsertPagamentoPedido(pedido, pagamentoNovo = {}) {
  pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

  const mpPaymentId = pagamentoNovo?.mpPaymentId ? String(pagamentoNovo.mpPaymentId) : "";
  if (mpPaymentId) {
    const idx = pedido.pagamentos.findIndex((p) => String(p?.mpPaymentId || "") === mpPaymentId);
    if (idx >= 0) {
      pedido.pagamentos[idx] = { ...pedido.pagamentos[idx], ...pagamentoNovo };
      return pedido.pagamentos[idx];
    }
  }

  pedido.pagamentos.push(pagamentoNovo);
  return pagamentoNovo;
}

/**
 * ✅ Recalcula:
 * - valorPago / valorPendente
 * - status = "pago" quando quitado
 */
/**
 * ✅ Recalcula:
 * - valorPago / valorPendente
 * - NO BALCÃO: só vai pra "em_producao" quando quitar 100%
 * - não altera o fluxo legado (mpPaymentId no pedido)
 */
/**
 * ✅ Recalcula:
 * - valorPago / valorPendente
 * - status vai para "em_producao" quando quitado
 * - marca statusPagamento="pago" (audit)
 */
/**
 * ✅ Recalcula:
 * - valorPago / valorPendente
 * - NO BALCÃO: só vai pra "em_producao" quando quitar 100%
 * - não altera o fluxo legado (mpPaymentId no pedido)
 */
function recalcPedidoParcial(pedido) {
  const total = round2(toNum(pedido.valorTotal));
  const pago = somaPagamentosConfirmados(pedido.pagamentos || []);
  const pendente = Math.max(0, round2(total - pago));

  pedido.valorPago = pago;
  pedido.valorPendente = pendente;

  const quitou = total > 0 && pendente <= 0;

  if (quitou) {
    // Vitrine/site precisa ser aceita pelo restaurante; balcão quitado segue direto.
    const origem = String(pedido.origem || "").toLowerCase();
    pedido.status = origem === "balcao" ? "em_producao" : "pago";

    // ✅ marca que está pago sem depender de status legado
    pedido.statusPagamento = "pago";

    if (!pedido.pagoEm) pedido.pagoEm = new Date();
    if (!pedido.fechadoEm) pedido.fechadoEm = new Date();
  } else {
    if (pedido.status !== "cancelado") pedido.status = "aguardando_pagamento";
    // aqui NÃO força statusPagamento (deixa null/pendente/como estiver)
  }

  return { total, pago, pendente };
}




/**
 * ✅ Handler principal
 * Compat:
 * - legado: pedido.mpPaymentId (pix total)
 * - parcial: pedido.pagamentos[].mpPaymentId
 */
exports.mpWebhook = async (req, res) => {
  try {
    const paymentId =
      req.query?.["data.id"] ||
      req.query?.id ||
      req.query?.data?.id ||
      req.body?.data?.id ||
      req.body?.resource?.id ||
      (String(req.body?.resource || "").match(/\/payments\/([^/?#]+)/)?.[1]) ||
      req.body?.id ||
      null;

    const type = String(req.query?.type || req.query?.topic || req.body?.type || req.body?.topic || "").toLowerCase();
    const action = String(req.body?.action || "").toLowerCase();
    const isPaymentEvent = type === "payment" || action.startsWith("payment.");

    if (!paymentId || !isPaymentEvent) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // assinatura opcional
    if (process.env.MP_WEBHOOK_SECRET && req.rawBody) {
      const sig = verifyMpSignature({ req, rawBody: req.rawBody });
      if (!sig.ok) return res.status(401).json({ ok: false, reason: sig.reason });
    }

    const paymentIdStr = String(paymentId);

    const mensalidade = await processarWebhookMensalidade(paymentIdStr).catch((e) => {
      console.warn("Falha ao processar mensalidade SaaS:", e?.message || e);
      return null;
    });
    if (mensalidade) {
      return res.status(200).json({
        ok: true,
        mode: "mensalidade_saas",
        paymentId: paymentIdStr,
        mpStatus: mensalidade?.mp?.status || null,
        paid: !!mensalidade?.result?.paid,
        restauranteId: mensalidade?.result?.restauranteId || mensalidade?.cobranca?.restauranteId || null,
      });
    }

    // ✅ acha pedido (legado ou parcial)
    const pedido = await Pedido.findOne({
      $or: [{ mpPaymentId: paymentIdStr }, { "pagamentos.mpPaymentId": paymentIdStr }],
    });

    if (!pedido) {
      return res.status(200).json({ ok: true, not_found: true });
    }

    // ✅ token do restaurante (vendedor conectado)
    const restaurante = await Restaurante.findById(pedido.restaurante).select("mercadoPago");
    const accessToken = restaurante?.mercadoPago?.accessToken;

    if (!accessToken) {
      return res.status(200).json({ ok: true, no_token: true });
    }

    // ✅ consulta MP
    const mp = await consultarPagamento({ accessToken, paymentId: paymentIdStr });
    const mpStatus = String(mp?.status || "").toLowerCase();
    const agora = new Date();

    // tenta localizar pagamento parcial
    const pagamentosArr = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
    const idx = pagamentosArr.findIndex((p) => String(p?.mpPaymentId || "") === paymentIdStr);
    const isPartial = idx >= 0;

    if (isPartial) {
      const pg = pagamentosArr[idx];

      // atualiza status do MP no subpagamento
      pg.mpStatus = mpStatus || pg.mpStatus || null;

      // mapeia status MP -> status do pagamento
      if (isPaidStatus(mpStatus)) {
        pg.status = "confirmado";
        if (!pg.confirmadoEm) pg.confirmadoEm = agora; // ✅ existe no schema? NÃO. Mas mongoose ignora se strict.
        // Como seu schema não tem confirmadoEm, não precisa. Vou remover abaixo:
      } else if (isFinalFailStatus(mpStatus)) {
        pg.status = "cancelado";
      } else {
        pg.status = "pendente";
      }

      // qr atualizado (se vier)
      const tx = mp?.point_of_interaction?.transaction_data;
      if (tx?.qr_code) pg.pixQrCode = tx.qr_code;
      if (tx?.qr_code_base64) pg.pixQrCodeBase64 = tx.qr_code_base64;

      // salva de volta no array
      pedido.pagamentos[idx] = pg;

      // forma de pagamento e totais
      setFormaPagamentoFromPagamentos(pedido);
      const { total, pago, pendente } = recalcPedidoParcial(pedido);

      const quitouTotal = total > 0 && pendente <= 0;

      // quitou -> libera mesa
      if (quitouTotal && pedido.mesaId) {
        const mesa = await Mesa.findById(pedido.mesaId);
        if (mesa) await liberarMesa({ mesa, io: req.io });
      }

      await pedido.save();

      if (quitouTotal) {
        await sincronizarVendaComCaixaAtual({ pedido, pagamento: pg }).catch((e) =>
          console.warn("Falha ao vincular pagamento parcial ao caixa atual:", e?.message || e)
        );
        await enviarConfirmacaoWhatsappSePossivel({ pedido, pagamento: pg, total });
      }

      if (req.io) {
        req.io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", pedido);
        if (quitouTotal) {
          req.io.to(`restaurante-${pedido.restaurante}`).emit("novoPedido", pedido);
        }
      }

      return res.status(200).json({
        ok: true,
        mode: "parcial",
        pedidoId: String(pedido._id),
        paymentId: paymentIdStr,
        mpStatus,
        quitouTotal,
        total,
        pago,
        pendente,
        formadePagamento: pedido.formadePagamento,
      });
    }

    // ✅ fluxo legado (PIX/cartão total no pedido)
    pedido.statusPagamento = mpStatus || pedido.statusPagamento;

    const metodoLegado = String(pedido.formadePagamento || "pix").toLowerCase().includes("cart")
      ? "cartao"
      : "pix";

    const valorLegado = round2(toNum(pedido.valorTotal || pedido.total || mp?.transaction_amount || 0));

    if (isPaidStatus(mpStatus)) {
      pedido.status = "pago";
      pedido.formadePagamento = metodoLegado;
      pedido.formaPagamento = metodoLegado;
      pedido.statusPagamento = "pago";
      pedido.valorPago = valorLegado;
      pedido.valorPendente = 0;

      upsertPagamentoPedido(pedido, {
        metodo: metodoLegado,
        valor: valorLegado,
        status: "confirmado",
        recebidoEm: pedido.criadoEm || agora,
        confirmadoEm: agora,
        recebidoPor: null,
        recebidoPorRole: "mercadopago",
        obs: metodoLegado === "cartao" ? "Cartão Mercado Pago confirmado" : "PIX Mercado Pago confirmado",
        mpPaymentId: paymentIdStr,
        mpStatus,
      });

      if (!pedido.pagoEm) pedido.pagoEm = agora;
      if (!pedido.fechadoEm) pedido.fechadoEm = agora;

      if (pedido.mesaId) {
        const mesa = await Mesa.findById(pedido.mesaId);
        if (mesa) await liberarMesa({ mesa, io: req.io });
      }
    } else if (isFinalFailStatus(mpStatus)) {
      upsertPagamentoPedido(pedido, {
        metodo: metodoLegado,
        valor: valorLegado,
        status: "cancelado",
        recebidoEm: pedido.criadoEm || agora,
        recebidoPor: null,
        recebidoPorRole: "mercadopago",
        obs: "Pagamento Mercado Pago recusado/cancelado",
        mpPaymentId: paymentIdStr,
        mpStatus,
      });
      if (pedido.status !== "cancelado" && pedido.status !== "pago") {
        pedido.status = "aguardando_pagamento";
      }
    } else {
      upsertPagamentoPedido(pedido, {
        metodo: metodoLegado,
        valor: valorLegado,
        status: "pendente",
        recebidoEm: pedido.criadoEm || agora,
        recebidoPor: null,
        recebidoPorRole: "mercadopago",
        obs: "Pagamento Mercado Pago aguardando aprovação",
        mpPaymentId: paymentIdStr,
        mpStatus,
      });
    }

    await pedido.save();

    if (isPaidStatus(mpStatus)) {
      await sincronizarVendaComCaixaAtual({
        pedido,
        pagamento: {
          metodo: metodoLegado,
          valor: valorLegado,
          status: "confirmado",
          mpPaymentId: paymentIdStr,
        },
      }).catch((e) =>
        console.warn("Falha ao vincular pagamento Mercado Pago ao caixa atual:", e?.message || e)
      );
    }

    if (req.io) {
      req.io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", pedido);
      if (isPaidStatus(mpStatus)) {
        req.io.to(`restaurante-${pedido.restaurante}`).emit("novoPedido", pedido);
      }
    }

    return res.status(200).json({
      ok: true,
      mode: "legado",
      pedidoId: String(pedido._id),
      paymentId: paymentIdStr,
      mpStatus,
      paid: isPaidStatus(mpStatus),
      formadePagamento: pedido.formadePagamento,
    });
  } catch (err) {
    console.error("🔥 MP webhook error:", err);
    return res.status(200).json({ ok: true, error: "ignored" });
  }
};
