// controllers/ifoodController.js
// Integracao iFood webhook-first:
// - restaurante vincula a loja via user code (distributed auth)
// - webhook central recebe eventos em tempo real
// - PLACED importa detalhes do pedido e grava no fluxo padrao MOVYO
const crypto = require("crypto");
const axios = require("axios");

const Restaurante = require("../models/Restaurante");
const Pedido = require("../models/Pedido");
const { queryWithRetry } = require("../lib/mysqlRetry");
const {
  getCaixaAberto,
  vincularPedidoAoCaixa,
  registrarMovimentoVenda,
  recalcularCaixa,
  round2,
  toNum,
} = require("../services/caixaService");

const AUTH_BASE_URL = String(process.env.IFOOD_AUTH_BASE_URL || "https://merchant-api.ifood.com.br/authentication/v1.0").replace(/\/$/, "");
const API_BASE_URL = String(process.env.IFOOD_API_BASE_URL || "https://merchant-api.ifood.com.br").replace(/\/$/, "");
const ORDER_BASE_URL = String(process.env.IFOOD_ORDER_BASE_URL || `${API_BASE_URL}/order/v1.0`).replace(/\/$/, "");
const IMPORT_BACKOFF_MS = [1500, 4000, 9000, 20000, 45000, 90000, 180000, 300000, 420000, 600000];

const importTimers = new Map();
let centralizedTokenCache = null;

function safeString(value, max = 255) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  return max ? text.slice(0, max) : text;
}

function normalizeKey(value) {
  return safeString(value, 255)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
}

function parseJsonSafe(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function getByPath(obj, path) {
  return String(path || "").split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function pick(obj, paths = [], fallback = undefined) {
  for (const path of paths) {
    const value = getByPath(obj, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function toMoney(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  let value = raw;
  if (typeof value === "object") {
    value = value.value ?? value.amount ?? value.total ?? value.price ?? value.centAmount ?? 0;
  }
  const n = toNum(value);
  if (!Number.isFinite(n)) return 0;
  if (Number.isInteger(n) && Math.abs(n) >= 1000 && Math.abs(n) % 5 === 0) return round2(n / 100);
  return round2(n);
}

function normalizeDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function tokenValue(data = {}) {
  return data.accessToken || data.access_token || data.token || "";
}

function refreshTokenValue(data = {}) {
  return data.refreshToken || data.refresh_token || "";
}

function expiresInValue(data = {}) {
  return Number(data.expiresIn ?? data.expires_in ?? 21600) || 21600;
}

function decodeJwtPayload(token) {
  try {
    const middle = String(token || "").split(".")[1];
    if (!middle) return {};
    const padded = middle.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(middle.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function merchantIdsFromToken(token) {
  const payload = decodeJwtPayload(token);
  const values = [
    payload.merchant_id,
    payload.merchantId,
    payload.tenantId,
    ...(Array.isArray(payload.merchant_scope) ? payload.merchant_scope : []),
    ...(Array.isArray(payload.merchant_scopes) ? payload.merchant_scopes : []),
  ];
  return [...new Set(values
    .map((item) => safeString(String(item || "").split(":")[0], 191))
    .filter(Boolean))];
}

function getPublicApiBaseUrl() {
  return String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL || process.env.APP_API_URL || "").replace(/\/$/, "");
}

function getAppUrl() {
  return process.env.APP_URL || "http://localhost:5173/#/configuracoes";
}

function requireIfoodEnv(requireSecret = false) {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || (requireSecret && !clientSecret)) {
    const error = new Error("Credenciais iFood ausentes no ambiente.");
    error.status = 500;
    error.missing = {
      IFOOD_CLIENT_ID: !!clientId,
      IFOOD_CLIENT_SECRET: !!clientSecret,
    };
    throw error;
  }
  return { clientId, clientSecret };
}

async function postForm(url, params) {
  const { data } = await axios.post(url, new URLSearchParams(params).toString(), {
    timeout: 15000,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  return data || {};
}

async function patchRestauranteIfood(restauranteId, patch = {}) {
  const restaurante = await Restaurante.findById(restauranteId);
  if (!restaurante) return null;
  const current = parseJsonSafe(restaurante.ifood, {});
  const next = { ...current, ...patch };
  await Restaurante.findByIdAndUpdate(restauranteId, { $set: { ifood: next } }, { new: true });
  return next;
}

async function getCentralizedToken() {
  if (centralizedTokenCache?.accessToken && centralizedTokenCache.expiresAt > Date.now() + 60000) {
    return centralizedTokenCache.accessToken;
  }
  const { clientId, clientSecret } = requireIfoodEnv(true);
  const data = await postForm(`${AUTH_BASE_URL}/oauth/token`, {
    grantType: "client_credentials",
    clientId,
    clientSecret,
  });
  const accessToken = tokenValue(data);
  if (!accessToken) throw new Error("iFood nao retornou accessToken.");
  centralizedTokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresInValue(data) * 1000,
  };
  return accessToken;
}

async function getTokenForRestaurante(restaurante) {
  const restauranteId = String(restaurante?._id || restaurante?.id || "");
  const ifood = parseJsonSafe(restaurante?.ifood, {});
  const expiresAt = ifood.tokenExpiraEm ? new Date(ifood.tokenExpiraEm).getTime() : 0;
  if (ifood.accessToken && expiresAt > Date.now() + 60000) return ifood.accessToken;

  if (ifood.refreshToken) {
    const { clientId, clientSecret } = requireIfoodEnv(true);
    const data = await postForm(`${AUTH_BASE_URL}/oauth/token`, {
      grantType: "refresh_token",
      clientId,
      clientSecret,
      refreshToken: ifood.refreshToken,
    });
    const accessToken = tokenValue(data);
    if (accessToken) {
      await patchRestauranteIfood(restauranteId, {
        accessToken,
        refreshToken: refreshTokenValue(data) || ifood.refreshToken,
        tokenExpiraEm: new Date(Date.now() + expiresInValue(data) * 1000),
        ultimoRefreshEm: new Date(),
        lastError: null,
      });
      return accessToken;
    }
  }

  return getCentralizedToken();
}

async function fetchIfoodOrderDetails(orderId, restaurante) {
  const token = await getTokenForRestaurante(restaurante);
  const { data } = await axios.get(`${ORDER_BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return data || {};
}

async function postIfoodOrderAction(restaurante, orderId, action) {
  const token = await getTokenForRestaurante(restaurante);
  const { data } = await axios.post(`${ORDER_BASE_URL}/orders/${encodeURIComponent(orderId)}/${action}`, null, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  return data || {};
}

async function confirmarPedidoNoIfood(pedido) {
  const origem = normalizeKey(pedido?.origem || pedido?.marketplace || pedido?.canalVenda);
  const orderId = safeString(pedido?.externalOrderId, 191);
  if (origem !== "ifood" || !orderId) return null;

  // Pedido criado pelo botao "Gerar pedido teste" do MOVYO nao existe na API real do iFood.
  if (/^IFTEST-/i.test(orderId)) {
    return { ok: true, skipped: true, reason: "pedido_teste_movyo", orderId };
  }

  const restaurante = pedido?.restaurante && typeof pedido.restaurante === "object"
    ? pedido.restaurante
    : await Restaurante.findById(pedido?.restaurante);
  if (!restaurante) {
    const error = new Error("Restaurante do pedido iFood nao encontrado.");
    error.status = 404;
    throw error;
  }

  try {
    const data = await postIfoodOrderAction(restaurante, orderId, "confirm");
    return { ok: true, action: "confirm", orderId, data };
  } catch (error) {
    const status = Number(error?.response?.status || error?.status || 0);
    const details = error?.response?.data || null;
    const message = details?.message || details?.error?.message || error?.message || "Falha ao confirmar pedido no iFood.";

    // 409 normalmente indica que a acao ja foi aplicada ou que o pedido mudou de estado.
    // Nao travamos o operador nesses casos para evitar duplo aceite/duplicidade operacional.
    if (status === 409) {
      return { ok: true, action: "confirm", alreadyProcessed: true, orderId, status, details };
    }

    const syncError = new Error(message);
    syncError.status = status || 502;
    syncError.details = details;
    throw syncError;
  }
}

function normalizeItems(order = {}) {
  const rawItems = pick(order, ["items", "itens", "order.items"], []) || [];
  const list = Array.isArray(rawItems) ? rawItems : [];
  return list.map((item, index) => {
    const quantity = Math.max(1, toNum(pick(item, ["quantity", "quantidade", "amount"], 1)) || 1);
    const totalItem = toMoney(pick(item, ["totalPrice", "totalPrice.value", "total", "price.total", "prices.total"], 0));
    const unit = toMoney(pick(item, ["unitPrice", "unitPrice.value", "price", "price.value", "unit.value"], 0));
    const precoUnitario = unit > 0 ? unit : round2(totalItem / quantity);
    const precoTotal = totalItem > 0 ? totalItem : round2(precoUnitario * quantity);
    const complements = pick(item, ["options", "complements", "garnishItems", "choices", "subItems", "modifiers"], []);
    const complementos = Array.isArray(complements)
      ? complements.map((c) => ({
          nome: safeString(pick(c, ["name", "nome", "description"], "Complemento"), 180),
          quantidade: Math.max(1, toNum(pick(c, ["quantity", "quantidade", "amount"], 1)) || 1),
          preco: toMoney(pick(c, ["price", "unitPrice", "total", "value"], 0)),
        }))
      : [];
    const observacoes = [
      pick(item, ["observations", "observation", "observacao", "note", "notes"], ""),
      complementos.length ? `Complementos: ${complementos.map((c) => `${c.quantidade}x ${c.nome}`).join(", ")}` : "",
    ].filter(Boolean).join(" | ");

    return {
      idExterno: safeString(pick(item, ["id", "externalCode", "productId", "sku"], `ifood-${index + 1}`), 120),
      produtoId: safeString(pick(item, ["productId", "sku", "externalCode"], ""), 120),
      nome: safeString(pick(item, ["name", "nome", "description", "product.name"], "Item iFood"), 180),
      quantidade: quantity,
      precoUnitario,
      preco: precoUnitario,
      precoTotal,
      total: precoTotal,
      observacao: safeString(observacoes, 800),
      complementos,
      origem: "ifood",
      marketplace: "ifood",
    };
  });
}

function normalizeAddress(order = {}) {
  const addr = pick(order, ["delivery.deliveryAddress", "delivery.address", "customer.address", "address"], {}) || {};
  if (typeof addr === "string") return safeString(addr, 500);
  const formatted = pick(addr, ["formattedAddress", "formatted", "fullAddress"], "");
  if (formatted) return safeString(formatted, 500);
  return [
    pick(addr, ["streetName", "street", "rua"], ""),
    pick(addr, ["streetNumber", "number", "numero"], ""),
    pick(addr, ["neighborhood", "bairro", "district"], ""),
    pick(addr, ["city", "cidade"], ""),
    pick(addr, ["state", "uf", "estado"], ""),
    pick(addr, ["complement", "complemento"], ""),
    pick(addr, ["reference", "referencia"], ""),
  ].map((v) => safeString(v, 120)).filter(Boolean).join(", ").slice(0, 500);
}

function normalizePaymentMethod(order = {}) {
  const raw = safeString(pick(order, [
    "payments.methods.0.method",
    "payments.methods.0.type",
    "payment.method",
    "payment.type",
    "paymentMethod",
  ], "ifood_online"), 120);
  const key = normalizeKey(raw);
  if (key.includes("pix")) return "pix";
  if (key.includes("debit") || key.includes("debito")) return "debito";
  if (key.includes("credit") || key.includes("credito") || key.includes("card") || key.includes("cartao")) return "credito";
  if (key.includes("cash") || key.includes("dinheiro")) return "dinheiro";
  return "ifood_online";
}

function isPrepaid(order = {}) {
  const value = pick(order, [
    "payments.prepaid",
    "payments.methods.0.prepaid",
    "payment.prepaid",
    "payment.isPrepaid",
  ], null);
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return normalizePaymentMethod(order) !== "dinheiro";
}

async function gerarNumeroIfood(restauranteId) {
  const [rows] = await queryWithRetry(
    `SELECT numeroPedido
       FROM pedidos
      WHERE restaurante = ? AND origem = 'ifood' AND numeroPedido LIKE 'IF%'
      ORDER BY criadoEm DESC, created_at DESC, id DESC
      LIMIT 1`,
    [String(restauranteId)],
    { label: "ifood.numeroPedido" }
  );
  const last = String(rows?.[0]?.numeroPedido || "").match(/IF(\d+)/)?.[1] || "0";
  return `IF${String(Number(last) + 1).padStart(5, "0")}`;
}

function buildPedidoFromIfood(order = {}, event = {}, restaurante = {}) {
  const restauranteId = String(restaurante._id || restaurante.id);
  const orderId = safeString(pick(order, ["id", "orderId"], pick(event, ["orderId", "metadata.id"], "")), 191);
  const merchantId = safeString(pick(order, ["merchant.id", "merchantId"], event.merchantId || restaurante.ifoodIdentificador || ""), 191);
  const displayId = safeString(pick(order, ["displayId", "shortCode", "code"], pick(event, ["displayId"], "")), 80);
  const itens = normalizeItems(order);
  const itensTotal = round2(itens.reduce((sum, item) => sum + toNum(item.precoTotal || item.total), 0));
  const taxaEntrega = toMoney(pick(order, ["delivery.deliveryFee.value", "delivery.deliveryFee", "deliveryFee", "total.deliveryFee"], 0));
  let total = toMoney(pick(order, [
    "total.orderAmount.value",
    "total.orderAmount",
    "total.total.value",
    "total.total",
    "total.value",
    "total",
    "orderTotal",
  ], 0));
  if (total <= 0) total = round2(itensTotal + taxaEntrega);
  const pago = isPrepaid(order);
  const agora = new Date();
  const customer = pick(order, ["customer"], {}) || {};
  const formaPagamento = normalizePaymentMethod(order);

  return {
    restaurante: restauranteId,
    numeroPedido: displayId || "",
    origem: "ifood",
    canalVenda: "marketplace",
    marketplace: "ifood",
    externalOrderId: orderId,
    externalMerchantId: merchantId,
    externalStatus: safeString(pick(event, ["fullCode", "code"], pick(order, ["status"], "PLACED")), 80),
    externalPayload: { event, order },
    nomeCliente: safeString(pick(customer, ["name", "nome"], "Cliente iFood"), 120),
    telefoneCliente: onlyDigits(pick(customer, ["phone.number", "phone", "phoneNumber"], "")),
    enderecoCliente: normalizeAddress(order),
    residenciaNumero: safeString(pick(order, ["delivery.deliveryAddress.streetNumber", "delivery.address.streetNumber"], ""), 40),
    residenciaComplemento: safeString(pick(order, ["delivery.deliveryAddress.complement", "delivery.address.complement"], ""), 120),
    residenciaReferencia: safeString(pick(order, ["delivery.deliveryAddress.reference", "delivery.address.reference"], ""), 180),
    residenciaBairro: safeString(pick(order, ["delivery.deliveryAddress.neighborhood", "delivery.address.neighborhood"], ""), 120),
    residenciaCep: onlyDigits(pick(order, ["delivery.deliveryAddress.postalCode", "delivery.address.postalCode"], "")),
    itens,
    total,
    valorTotal: total,
    totalBruto: total,
    taxaEntrega,
    taxaMarketplace: toMoney(pick(order, ["fees.marketplace", "commission.value", "financial.commission"], 0)),
    valorRepasse: toMoney(pick(order, ["financial.netValue", "settlement.value", "netValue"], 0)),
    formaPagamento,
    formadePagamento: formaPagamento,
    status: "pendente",
    statusPagamento: pago ? "pago" : "pendente",
    valorPago: pago ? total : 0,
    valorPendente: pago ? 0 : total,
    pagoEm: pago ? agora : null,
    criadoEm: normalizeDate(pick(order, ["createdAt", "created_at", "orderCreatedAt"], event.createdAt || Date.now()), agora),
    statusAtualizadoEm: agora,
    pagamentos: pago
      ? [{ metodo: formaPagamento, valor: total, status: "confirmado", recebidoEm: agora, confirmadoEm: agora, recebidoPorRole: "ifood" }]
      : [],
    observacao: safeString(pick(order, ["observations", "observation", "extraInfo"], ""), 800),
    recebidoPor: "ifood",
    recebidoPorNome: "iFood",
  };
}

async function criarOuAtualizarPedidoIfood(order, event, restaurante, io = null) {
  const normalized = buildPedidoFromIfood(order, event, restaurante);
  if (!normalized.externalOrderId) {
    const error = new Error("Evento iFood sem orderId.");
    error.status = 400;
    throw error;
  }
  if (!normalized.itens.length) {
    const error = new Error("Detalhes iFood sem itens. Pedido nao importado para evitar cupom vazio.");
    error.status = 422;
    throw error;
  }

  const restauranteId = normalized.restaurante;
  let pedido = await Pedido.findOne({
    restaurante: restauranteId,
    origem: "ifood",
    externalOrderId: normalized.externalOrderId,
  });

  if (pedido) {
    Object.assign(pedido, {
      externalStatus: normalized.externalStatus,
      externalPayload: normalized.externalPayload,
      statusAtualizadoEm: new Date(),
    });
    await pedido.save();
    io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { pedido, created: false };
  }

  normalized.numeroPedido = normalized.numeroPedido || await gerarNumeroIfood(restauranteId);
  pedido = new Pedido(normalized);
  const caixa = await getCaixaAberto(restauranteId).catch(() => null);
  if (caixa) await vincularPedidoAoCaixa(pedido, caixa);
  await pedido.save();

  if (caixa && pedido.statusPagamento === "pago") {
    await registrarMovimentoVenda({
      pedido,
      pagamento: { metodo: pedido.formaPagamento || "ifood_online", valor: pedido.total, status: "confirmado", paymentId: pedido.externalOrderId },
      caixa,
      restauranteId,
    }).catch((error) => console.warn("Falha ao registrar venda iFood no caixa:", error?.message || error));
    await recalcularCaixa(caixa._id || caixa.id).catch(() => null);
  }

  io?.to(`restaurante-${restauranteId}`).emit("novoPedido", pedido);
  io?.to(`restaurante-${restauranteId}`).emit("caixaAtualizado", { origem: "ifood" });
  return { pedido, created: true };
}

async function findRestauranteByMerchant(merchantId) {
  const id = safeString(merchantId, 191);
  if (!id) return null;
  const byLegacy = await Restaurante.findOne({ ifoodIdentificador: id });
  if (byLegacy) return byLegacy;
  const restaurantes = await Restaurante.find({}).lean();
  const found = (restaurantes || []).find((restaurante) => {
    const ifood = parseJsonSafe(restaurante.ifood, {});
    const ids = [
      ifood.merchantId,
      ifood.merchant_id,
      ...(Array.isArray(ifood.merchantIds) ? ifood.merchantIds : []),
    ].map((v) => safeString(v, 191)).filter(Boolean);
    return ids.includes(id);
  });
  return found ? Restaurante.findById(found._id || found.id) : null;
}

function shouldRetryImport(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  return !status || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}

function scheduleIfoodOrderImport(event, restauranteId, io = null, attempt = 0) {
  const orderId = safeString(event.orderId || event.metadata?.id || event.metadata?.orderId, 191);
  if (!orderId) return;
  const key = `${restauranteId}:${orderId}`;
  if (importTimers.has(key)) return;
  const delay = attempt === 0 ? 0 : IMPORT_BACKOFF_MS[Math.min(attempt - 1, IMPORT_BACKOFF_MS.length - 1)];
  const timer = setTimeout(async () => {
    importTimers.delete(key);
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return;
    try {
      const order = await fetchIfoodOrderDetails(orderId, restaurante);
      const result = await criarOuAtualizarPedidoIfood(order, event, restaurante, io);
      await patchRestauranteIfood(restauranteId, {
        ultimoPedidoImportadoEm: new Date(),
        ultimoPedidoImportadoId: orderId,
        lastError: null,
      });
      console.log(`[iFood] Pedido ${orderId} ${result.created ? "criado" : "atualizado"}.`);
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || String(error);
      console.warn(`[iFood] Falha ao importar ${orderId} tentativa ${attempt + 1}:`, message);
      await patchRestauranteIfood(restauranteId, {
        lastError: message,
        ultimoErroEm: new Date(),
      }).catch(() => null);
      if (attempt < IMPORT_BACKOFF_MS.length && shouldRetryImport(error)) {
        scheduleIfoodOrderImport(event, restauranteId, io, attempt + 1);
      }
    }
  }, delay);
  importTimers.set(key, timer);
}

async function updateExistingOrderStatus(event, restaurante, statusPatch = {}) {
  const orderId = safeString(event.orderId || event.metadata?.id || event.metadata?.orderId, 191);
  if (!orderId) return null;
  const restauranteId = String(restaurante._id || restaurante.id);
  const pedido = await Pedido.findOne({ restaurante: restauranteId, origem: "ifood", externalOrderId: orderId });
  if (!pedido) return null;
  Object.assign(pedido, {
    externalStatus: safeString(event.fullCode || event.code || pedido.externalStatus, 80),
    statusAtualizadoEm: new Date(),
    externalPayload: { ...(pedido.externalPayload || {}), lastEvent: event },
    ...statusPatch,
  });
  await pedido.save();
  return pedido;
}

function normalizeEvents(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.events)) return body.events;
  if (Array.isArray(body?.data)) return body.data;
  return body ? [body] : [];
}

function signatureRequired() {
  const explicit = process.env.IFOOD_REQUIRE_WEBHOOK_SIGNATURE;
  if (explicit !== undefined) return normalizeKey(explicit) !== "false";
  return process.env.NODE_ENV === "production";
}

function verifyWebhookSignature(req) {
  const secret = process.env.IFOOD_WEBHOOK_SECRET || process.env.IFOOD_CLIENT_SECRET || "";
  const skip = normalizeKey(process.env.IFOOD_SKIP_WEBHOOK_SIGNATURE) === "true";
  if (skip) return { ok: true, skipped: true };
  if (!signatureRequired() && !secret) return { ok: true, skipped: true };
  if (!secret) return { ok: false, reason: "IFOOD_CLIENT_SECRET/IFOOD_WEBHOOK_SECRET ausente." };

  const received = safeString(req.headers["x-ifood-signature"] || req.headers["X-IFood-Signature"] || "", 500)
    .replace(/^sha256=/i, "");
  if (!received) return { ok: false, reason: "Header X-IFood-Signature ausente." };

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  if (!a.length || a.length !== b.length) return { ok: false, reason: "Assinatura iFood em formato invalido." };
  return { ok: crypto.timingSafeEqual(a, b), reason: "Assinatura iFood invalida." };
}

async function processIfoodEvent(event, io = null) {
  const code = normalizeKey(event.fullCode || event.code || event.eventType || event.type);
  const merchantId = safeString(event.merchantId || event.metadata?.merchantId || event.payload?.merchantId, 191);
  const restaurante = await findRestauranteByMerchant(merchantId);
  if (!restaurante) {
    return { ok: false, ignored: true, reason: `Restaurante nao encontrado para merchantId ${merchantId || "-"}.` };
  }
  if (restaurante.ifoodStatus === false || restaurante.ifoodStatus === 0) {
    return { ok: false, ignored: true, reason: "Integracao iFood desativada neste restaurante." };
  }
  const restauranteId = String(restaurante._id || restaurante.id);

  if (["plc", "placed", "orderplaced"].includes(code)) {
    scheduleIfoodOrderImport(event, restauranteId, io, 0);
    return { ok: true, accepted: true, action: "import_scheduled" };
  }

  if (code.includes("cancel")) {
    const pedido = await updateExistingOrderStatus(event, restaurante, {
      status: "cancelado",
      statusPagamento: "cancelado",
      canceladoEm: new Date(),
      motivoCancelamento: safeString(event.metadata?.cancelReasonDescription || event.metadata?.reasonDescription || "Cancelado no iFood", 255),
    });
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "cancel_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("confirmed") || code === "cfm") {
    const pedido = await updateExistingOrderStatus(event, restaurante, { status: "em_producao", aceitoEm: new Date() });
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "confirmed_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("concluded")) {
    const pedido = await updateExistingOrderStatus(event, restaurante, { status: "entregue", entregueEm: new Date() });
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "concluded_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  await patchRestauranteIfood(restauranteId, {
    ultimoEventoRecebidoEm: new Date(),
    ultimoEventoCodigo: event.fullCode || event.code || "",
  }).catch(() => null);
  return { ok: true, ignored: true, action: "event_registered" };
}

exports.status = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || "");
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante nao encontrado." });
    const ifood = parseJsonSafe(restaurante.ifood, {});
    const safeIfood = { ...ifood };
    delete safeIfood.accessToken;
    delete safeIfood.refreshToken;
    delete safeIfood.authorizationCodeVerifier;
    return res.json({
      ok: true,
      conectado: !!(restaurante.ifoodStatus || ifood.conectado || ifood.accessToken),
      ativo: restaurante.ifoodStatus !== false && restaurante.ifoodStatus !== 0,
      merchantId: ifood.merchantId || restaurante.ifoodIdentificador || "",
      merchantIds: ifood.merchantIds || [],
      tokenExpiraEm: ifood.tokenExpiraEm || null,
      ultimoOAuthEm: ifood.ultimoOAuthEm || null,
      ultimoPedidoImportadoEm: ifood.ultimoPedidoImportadoEm || null,
      lastError: ifood.lastError || null,
      userCode: ifood.userCode || "",
      verificationUrl: ifood.verificationUrl || "",
      verificationUrlComplete: ifood.verificationUrlComplete || "",
      codeExpiresAt: ifood.codeExpiresAt || null,
      webhookUrl: getPublicApiBaseUrl() ? `${getPublicApiBaseUrl()}/api/ifood/webhook` : "",
      env: {
        clientIdConfigurado: !!process.env.IFOOD_CLIENT_ID,
        clientSecretConfigurado: !!process.env.IFOOD_CLIENT_SECRET,
        publicApiBaseUrlConfigurado: !!getPublicApiBaseUrl(),
        assinaturaObrigatoria: signatureRequired(),
      },
      ifood: safeIfood,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.message || "Erro ao consultar iFood." });
  }
};

exports.requestUserCode = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || "");
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante nao encontrado." });
    const { clientId } = requireIfoodEnv(false);
    const data = await postForm(`${AUTH_BASE_URL}/oauth/userCode`, { clientId });
    const expiresIn = Number(data.expiresIn || data.expires_in || 600);
    const codeExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const next = await patchRestauranteIfood(restauranteId, {
      userCode: data.userCode || data.user_code || "",
      authorizationCodeVerifier: data.authorizationCodeVerifier || data.authorization_code_verifier || "",
      verificationUrl: data.verificationUrl || data.verification_url || "",
      verificationUrlComplete: data.verificationUrlComplete || data.verification_url_complete || "",
      codeExpiresAt,
      ultimoUserCodeEm: new Date(),
      lastError: null,
    });
    return res.json({
      ok: true,
      userCode: next.userCode,
      verificationUrl: next.verificationUrl,
      verificationUrlComplete: next.verificationUrlComplete,
      codeExpiresAt: next.codeExpiresAt,
      expiresIn,
    });
  } catch (error) {
    console.error("[iFood user-code]", error?.response?.data || error);
    return res.status(error.status || error?.response?.status || 500).json({
      ok: false,
      message: error?.response?.data?.message || error.message || "Erro ao gerar codigo iFood.",
      missing: error.missing,
    });
  }
};

exports.completeAuthorization = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || "");
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante nao encontrado." });
    const ifood = parseJsonSafe(restaurante.ifood, {});
    const authorizationCode = safeString(req.body?.authorizationCode || req.body?.codigoAutorizacao || "", 500);
    const authorizationCodeVerifier = safeString(ifood.authorizationCodeVerifier || req.body?.authorizationCodeVerifier || "", 500);
    const merchantIdManual = safeString(req.body?.merchantId || req.body?.merchant_id || "", 191);
    if (!authorizationCode) return res.status(400).json({ ok: false, message: "Informe o codigo de autorizacao do Portal iFood." });
    if (!authorizationCodeVerifier) return res.status(400).json({ ok: false, message: "Gere um userCode antes de confirmar o vinculo." });

    const { clientId, clientSecret } = requireIfoodEnv(true);
    const data = await postForm(`${AUTH_BASE_URL}/oauth/token`, {
      grantType: "authorization_code",
      clientId,
      clientSecret,
      authorizationCode,
      authorizationCodeVerifier,
    });
    const accessToken = tokenValue(data);
    if (!accessToken) throw new Error("iFood nao retornou accessToken.");
    const merchantIds = merchantIdsFromToken(accessToken);
    const merchantId = merchantIdManual || merchantIds[0] || ifood.merchantId || restaurante.ifoodIdentificador || "";
    const nextIfood = {
      ...ifood,
      conectado: true,
      accessToken,
      refreshToken: refreshTokenValue(data) || ifood.refreshToken || null,
      tokenExpiraEm: new Date(Date.now() + expiresInValue(data) * 1000),
      ultimoOAuthEm: new Date(),
      merchantId,
      merchantIds: [...new Set([merchantId, ...merchantIds].filter(Boolean))],
      scopes: data.scope ? String(data.scope).split(" ") : ifood.scopes || [],
      userCode: "",
      authorizationCodeVerifier: "",
      lastError: null,
    };
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        ifood: nextIfood,
        ifoodStatus: true,
        ifoodIdentificador: merchantId,
      },
    }, { new: true });
    return res.json({
      ok: true,
      conectado: true,
      merchantId,
      merchantIds: nextIfood.merchantIds,
      tokenExpiraEm: nextIfood.tokenExpiraEm,
      webhookUrl: getPublicApiBaseUrl() ? `${getPublicApiBaseUrl()}/api/ifood/webhook` : "",
    });
  } catch (error) {
    console.error("[iFood complete]", error?.response?.data || error);
    return res.status(error.status || error?.response?.status || 500).json({
      ok: false,
      message: error?.response?.data?.message || error.message || "Erro ao concluir vinculo iFood.",
      missing: error.missing,
    });
  }
};

exports.disconnect = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || "");
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante nao encontrado." });
    const ifood = parseJsonSafe(restaurante.ifood, {});
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        ifoodStatus: false,
        ifood: {
          ...ifood,
          conectado: false,
          accessToken: null,
          refreshToken: null,
          tokenExpiraEm: null,
          desconectadoEm: new Date(),
        },
      },
    }, { new: true });
    return res.json({ ok: true, message: "iFood desconectado." });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.message || "Erro ao desconectar iFood." });
  }
};

exports.webhook = async (req, res) => {
  try {
    const signature = verifyWebhookSignature(req);
    if (!signature.ok) return res.status(401).json({ ok: false, message: signature.reason });

    const events = normalizeEvents(req.body);
    const results = [];
    for (const event of events) {
      results.push(await processIfoodEvent(event, req.io));
    }
    return res.status(202).json({ ok: true, received: events.length, results });
  } catch (error) {
    console.error("[iFood webhook]", error?.response?.data || error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || "Erro ao processar webhook iFood." });
  }
};

exports.criarPedidoTeste = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || "");
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante nao encontrado." });
    const merchantId = restaurante.ifoodIdentificador || parseJsonSafe(restaurante.ifood, {}).merchantId || `ifood-teste-${restauranteId}`;
    await Restaurante.findByIdAndUpdate(restauranteId, {
      $set: {
        ifoodStatus: true,
        ifoodIdentificador: merchantId,
        ifood: { ...parseJsonSafe(restaurante.ifood, {}), conectado: true, merchantId },
      },
    }, { new: true });
    const event = {
      id: `evt-test-${Date.now()}`,
      code: "PLC",
      fullCode: "PLACED",
      merchantId,
      orderId: `IFTEST-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const order = {
      id: event.orderId,
      displayId: `IFT${String(Date.now()).slice(-5)}`,
      merchant: { id: merchantId },
      createdAt: new Date().toISOString(),
      customer: { name: "Cliente Teste iFood", phone: { number: "81999999999" } },
      delivery: {
        deliveryFee: { value: 5 },
        deliveryAddress: {
          streetName: "Rua Teste iFood",
          streetNumber: "100",
          neighborhood: "Centro",
          city: "Olinda",
          state: "PE",
          complement: "Apto 101",
          reference: "Proximo a praca",
          postalCode: "53000000",
        },
      },
      items: [
        { id: "ifood-1", name: "Pedido teste iFood", quantity: 1, unitPrice: { value: 28 }, totalPrice: { value: 28 } },
      ],
      payments: { prepaid: true, methods: [{ method: "ONLINE", prepaid: true, value: 33 }] },
      total: { orderAmount: { value: 33 }, deliveryFee: { value: 5 } },
      observations: "Pedido teste gerado pelo MOVYO.",
    };
    const updated = await Restaurante.findById(restauranteId);
    const result = await criarOuAtualizarPedidoIfood(order, event, updated, req.io);
    return res.status(result.created ? 201 : 200).json({ ok: true, created: result.created, pedido: result.pedido });
  } catch (error) {
    console.error("[iFood pedido teste]", error?.response?.data || error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || "Erro ao criar pedido teste iFood." });
  }
};

// Compatibilidade com rota antiga /connect-url.
// O fluxo recomendado agora e userCode: a tela nova chama /user-code.
exports.startOAuth = exports.requestUserCode;

exports.callbackOAuth = async (_req, res) => {
  return res.redirect(`${getAppUrl()}?ifood=manual`);
};

exports._private = {
  buildPedidoFromIfood,
  confirmarPedidoNoIfood,
  criarOuAtualizarPedidoIfood,
  processIfoodEvent,
  verifyWebhookSignature,
};

exports.confirmarPedidoNoIfood = confirmarPedidoNoIfood;
