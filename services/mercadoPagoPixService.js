// services/mercadoPagoPixService.js
const axios = require("axios");

const MP_API = "https://api.mercadopago.com";

/* =========================
   Helpers
========================= */
function normTel(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function emailValidoPorTelefone(telefone) {
  const t = normTel(telefone);
  // domínio real reservado (válido sintaticamente)
  return `cliente_${t || "semtelefone"}@example.com`;
}

/**
 * Decide payer email conforme ambiente/token
 * - PROD (APP_USR): evita testuser.com
 * - TEST (TEST-): pode usar MP_TEST_PAYER_EMAIL
 */
function pickPayerEmail({ accessToken, telefoneCliente, clienteEmail }) {
  const token = String(accessToken || "");
  const isProd = token.startsWith("APP_USR");
  const isTest = token.startsWith("TEST-");

  const email = String(clienteEmail || "").trim().toLowerCase();

  if (email) {
    if (isProd && email.includes("@testuser.com")) {
      // ignora test payer em produção
    } else if (email.includes("@") && email.includes(".")) {
      return email;
    }
  }

  if (isTest) {
    const testEmail = String(process.env.MP_TEST_PAYER_EMAIL || "")
      .trim()
      .toLowerCase();
    if (testEmail && testEmail.includes("@")) return testEmail;
  }

  return emailValidoPorTelefone(telefoneCliente);
}

function splitName(nomeCliente) {
  const nome = String(nomeCliente || "Cliente").trim();
  const parts = nome.split(/\s+/).filter(Boolean);
  const first_name = parts[0] || "Cliente";
  const last_name = parts.slice(1).join(" ") || "Movyo";
  return { first_name, last_name };
}

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * ✅ Monta additional_info.items para melhorar aprovação (PIX também aceita)
 * Espera itens no padrão do seu pedido/carrinho:
 * {
 *   produtoId, _id, id, sku,
 *   nome, descricao,
 *   quantidade,
 *   precoUnitario, precoTotal,
 *   amount (centavos),
 *   category_id
 * }
 */
function buildMpItems(itens = []) {
  return (itens || [])
    .filter(Boolean)
    .map((it) => {
      const quantity = Number(it?.quantidade ?? it?.quantity ?? 1) || 1;

      // unit_price precisa ser unitário (não total)
      const unit_price =
        it?.precoUnitario != null
          ? Number(it.precoUnitario)
          : it?.precoTotal != null
          ? round2(Number(it.precoTotal) / quantity)
          : it?.amount != null
          ? round2(Number(it.amount) / 100 / quantity)
          : 0;

      return {
        id: String(it?.produtoId || it?._id || it?.id || it?.sku || it?.nome || "item"),
        title: String(it?.nome || it?.title || "Item"),
        description: String(it?.descricao || it?.description || it?.nome || "Item"),
        category_id: String(it?.category_id || "others"),
        quantity,
        unit_price: round2(unit_price),
      };
    })
    .filter((it) => it.unit_price > 0 && it.quantity > 0);
}

/**
 * ✅ Fee FIXO em R$
 * Use env MP_PLATFORM_FEE_FIXED (ex: 0.50)
 * Default: 0.50
 */
function calcApplicationFeeFixed() {
  const raw = process.env.MP_PLATFORM_FEE_FIXED ?? "0.50";
  const fee = Number(String(raw).replace(",", "."));
  return Number.isFinite(fee) && fee > 0 ? Number(fee.toFixed(2)) : 0;
}

function buildIdempotencyKey({ pedidoId, amount, restauranteId, mesaId }) {
  // idempotência deve ser estável e única por intenção de cobrança
  const a = String(Number(amount).toFixed(2)).replace(".", "");
  return `pix_${String(restauranteId || "rest")}_${String(mesaId || "mesa")}_${String(pedidoId)}_${a}`;
}

/**
 * Tenta extrair mensagem amigável do MP
 */
function mpMessage(mp) {
  if (!mp) return "";
  if (typeof mp === "string") return mp;
  return mp?.message || mp?.error || "";
}

/**
 * Detecta quando o MP NÃO permite application_fee nesse pagamento
 */
function isApplicationFeeNotAllowed(mp) {
  const msg = mpMessage(mp).toLowerCase();
  return msg.includes("cannot use application_fee");
}

/**
 * Detecta erro de chave PIX/QR do collector (ex: conta sem chave habilitada)
 */
function isCollectorWithoutPixKey(mp) {
  const msg = mpMessage(mp).toLowerCase();
  return msg.includes("collector user without key enabled");
}

/* =========================
   PIX - Criar pagamento (com split fee fixo)
========================= */
/**
 * Cria pagamento PIX no Mercado Pago
 * ✅ Marketplace:
 * - accessToken DEVE ser do restaurante (collector)
 * - application_fee = sua taxa (R$ fixo)
 *
 * ✅ Melhora aprovação:
 * - envia additional_info.items (id, title, description, category_id, quantity, unit_price)
 *
 * Retorna:
 * {
 *   paymentId, status, status_detail,
 *   qrCode, qrCodeBase64,
 *   fee_details, collector_id, net_received_amount
 * }
 */
async function criarPagamentoPix({
  accessToken,
  pedidoId,
  valorTotal,
  nomeCliente,
  telefoneCliente,
  clienteEmail, // opcional
  restauranteId, // opcional (idempotência)
  mesaId, // opcional (idempotência)

  // ✅ split:
  applicationFee, // opcional (R$). Se não vier, usa MP_PLATFORM_FEE_FIXED
  description, // opcional

  // ✅ itens do carrinho/pedido para additional_info.items
  itens, // array
}) {
  if (!accessToken) {
    const err = new Error("Restaurante sem accessToken Mercado Pago.");
    err.status = 400;
    throw err;
  }

  const amount = Number(valorTotal);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error("valorTotal inválido para gerar PIX.");
    err.status = 400;
    throw err;
  }

  const { first_name, last_name } = splitName(nomeCliente);
  const payerEmail = pickPayerEmail({
    accessToken,
    telefoneCliente,
    clienteEmail,
  });

  // ✅ fee final (fixo)
  let fee = 0;
  if (applicationFee !== undefined && applicationFee !== null) {
    fee = Number(applicationFee);
    if (!Number.isFinite(fee) || fee < 0) {
      const err = new Error("applicationFee inválido.");
      err.status = 400;
      throw err;
    }
  } else {
    fee = calcApplicationFeeFixed(); // ✅ sempre fixo
  }

  if (fee >= amount) {
    const err = new Error("application_fee não pode ser maior/igual ao total.");
    err.status = 400;
    throw err;
  }

  const idemKey = buildIdempotencyKey({ pedidoId, amount, restauranteId, mesaId });

  // ✅ items para antifraude/aprovação
  const mpItems = buildMpItems(itens || []);

  // ========= 1) tenta com application_fee (split) =========
  const bodyWithFee = {
    transaction_amount: Number(amount.toFixed(2)),
    description: description || `Pedido ${pedidoId}`,
    payment_method_id: "pix",
    payer: {
      email: payerEmail,
      first_name,
      last_name,
    },
    external_reference: String(pedidoId),
    ...(fee > 0 ? { application_fee: Number(fee.toFixed(2)) } : {}),
    ...(mpItems.length > 0
      ? {
          additional_info: {
            items: mpItems,
          },
        }
      : {}),
  };

  try {
    const res = await axios.post(`${MP_API}/v1/payments`, bodyWithFee, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idemKey,
      },
      timeout: 20000,
    });

    const data = res.data || {};
    const td = data?.point_of_interaction?.transaction_data || {};

    return {
      paymentId: data.id,
      status: data.status,
      status_detail: data.status_detail,

      qrCode: td.qr_code || "",
      qrCodeBase64: td.qr_code_base64 || "",

      // ✅ comprovação de split
      fee_details: data?.fee_details || [],
      collector_id: data?.collector_id,
      net_received_amount: data?.transaction_details?.net_received_amount,
    };
  } catch (error) {
    const status = error?.response?.status || 500;
    const mp = error?.response?.data || null;

    // Caso: conta do restaurante sem chave Pix habilitada
    if (status === 400 && isCollectorWithoutPixKey(mp)) {
      const err = new Error(
        "A conta do recebedor (restaurante) não tem chave PIX habilitada no Mercado Pago para gerar QR Code. " +
          "Peça para habilitar PIX/Chave PIX na conta e tentar novamente."
      );
      err.status = 400;
      err.code = "MP_COLLECTOR_NO_PIX_KEY";
      err.mp = mp;
      throw err;
    }

    // Caso: MP não permite application_fee nesse tipo de pagamento
    if (status === 400 && isApplicationFeeNotAllowed(mp)) {
      const err = new Error(
        "O Mercado Pago não permite application_fee neste pagamento PIX para a conta/fluxo atual. " +
          "Para split (marketplace fee), é preciso que sua conta/integração esteja habilitada corretamente como marketplace. " +
          "Alternativa: cobrar a taxa fora do pagamento (mensalidade) ou ajustar o produto MP."
      );
      err.status = 400;
      err.code = "MP_APP_FEE_NOT_ALLOWED";
      err.mp = mp;
      throw err;
    }

    // Erro genérico do MP
    const err = new Error(
      mp?.message || mp?.error || error?.message || "Erro ao criar pagamento PIX no Mercado Pago."
    );
    err.status = status;
    err.mp = mp;
    throw err;
  }
}

/* =========================
   PIX - Consultar pagamento
========================= */
/**
 * Consulta pagamento
 * Retorna também dados pra comprovar split:
 * - fee_details
 * - collector_id
 * - net_received_amount
 */
async function consultarPagamento({ accessToken, paymentId }) {
  if (!accessToken) {
    const err = new Error("Sem accessToken Mercado Pago.");
    err.status = 400;
    throw err;
  }
  if (!paymentId) {
    const err = new Error("paymentId é obrigatório.");
    err.status = 400;
    throw err;
  }

  try {
    const res = await axios.get(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });

    return {
      id: res.data?.id,
      status: res.data?.status,
      status_detail: res.data?.status_detail,

      // ✅ comprovação de split
      fee_details: res.data?.fee_details || [],
      collector_id: res.data?.collector_id,
      transaction_amount: res.data?.transaction_amount,
      net_received_amount: res.data?.transaction_details?.net_received_amount,
    };
  } catch (error) {
    const status = error?.response?.status || 500;
    const mp = error?.response?.data || null;

    const err = new Error(
      mp?.message || mp?.error || error?.message || "Erro ao consultar pagamento no Mercado Pago."
    );
    err.status = status;
    err.mp = mp;
    throw err;
  }
}

module.exports = { criarPagamentoPix, consultarPagamento };
