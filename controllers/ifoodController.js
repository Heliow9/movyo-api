// controllers/ifoodController.js
// Integracao iFood webhook-first:
// - restaurante vincula a loja via user code (distributed auth)
// - webhook central recebe eventos em tempo real
// - PLACED importa detalhes do pedido e grava no fluxo padrao MOVYO
const crypto = require("crypto");
const axios = require("axios");

const Restaurante = require("../models/Restaurante");
const Pedido = require("../models/Pedido");
const IfoodEvent = require("../models/IfoodEvent");
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

async function postIfoodOrderAction(restaurante, orderId, action, body = null) {
  const token = await getTokenForRestaurante(restaurante);
  const { data } = await axios.post(`${ORDER_BASE_URL}/orders/${encodeURIComponent(orderId)}/${action}`, body, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  return data || {};
}

async function getIfoodOrderResource(restaurante, orderId, resource) {
  const token = await getTokenForRestaurante(restaurante);
  const { data } = await axios.get(`${ORDER_BASE_URL}/orders/${encodeURIComponent(orderId)}/${resource}`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return data || {};
}

function isIfoodPedido(pedido) {
  return normalizeKey(pedido?.origem || pedido?.marketplace || pedido?.canalVenda) === "ifood" && !!safeString(pedido?.externalOrderId, 191);
}

async function getRestauranteDoPedido(pedido) {
  const restaurante = pedido?.restaurante && typeof pedido.restaurante === "object"
    ? pedido.restaurante
    : await Restaurante.findById(pedido?.restaurante);
  if (!restaurante) {
    const error = new Error("Restaurante do pedido iFood nao encontrado.");
    error.status = 404;
    throw error;
  }
  return restaurante;
}

function normalizeIfoodActionError(error, fallbackMessage) {
  const status = Number(error?.response?.status || error?.status || 0);
  const details = error?.response?.data || null;
  if (status === 409) return { ok: true, alreadyProcessed: true, status, details };
  const syncError = new Error(details?.message || details?.error?.message || error?.message || fallbackMessage);
  syncError.status = status || 502;
  syncError.details = details;
  throw syncError;
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

async function marcarPedidoProntoNoIfood(pedido) {
  if (!isIfoodPedido(pedido)) return null;
  if (/^IFTEST-/i.test(pedido.externalOrderId)) return { ok: true, skipped: true, action: "readyToPickup" };
  const restaurante = await getRestauranteDoPedido(pedido);
  try {
    const data = await postIfoodOrderAction(restaurante, pedido.externalOrderId, "readyToPickup");
    return { ok: true, action: "readyToPickup", orderId: pedido.externalOrderId, data };
  } catch (error) {
    return { ...normalizeIfoodActionError(error, "Falha ao informar pedido pronto ao iFood."), action: "readyToPickup", orderId: pedido.externalOrderId };
  }
}

async function iniciarPreparoNoIfood(pedido) {
  if (!isIfoodPedido(pedido)) return null;
  const startAt = pedido.ifoodPreparationStartAt ? new Date(pedido.ifoodPreparationStartAt).getTime() : 0;
  if (Number.isFinite(startAt) && startAt > Date.now() + 60000) {
    const error = new Error(`Pedido agendado. Inicie o preparo a partir de ${new Date(startAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`);
    error.status = 409;
    throw error;
  }
  if (/^IFTEST-/i.test(pedido.externalOrderId)) return { ok: true, skipped: true, action: "startPreparation" };
  const restaurante = await getRestauranteDoPedido(pedido);
  try {
    const data = await postIfoodOrderAction(restaurante, pedido.externalOrderId, "startPreparation");
    return { ok: true, action: "startPreparation", orderId: pedido.externalOrderId, data };
  } catch (error) {
    return { ...normalizeIfoodActionError(error, "Falha ao iniciar o preparo no iFood."), action: "startPreparation", orderId: pedido.externalOrderId };
  }
}

async function despacharPedidoNoIfood(pedido) {
  if (!isIfoodPedido(pedido)) return null;
  const provider = normalizeKey(pedido.deliveryProvider || getByPath(pedido.externalPayload, "order.delivery.deliveredBy"));
  if (provider === "ifood") {
    const error = new Error("A entrega deste pedido e feita pelo iFood. Nao acione motorista proprio.");
    error.status = 409;
    throw error;
  }
  if (/^IFTEST-/i.test(pedido.externalOrderId)) return { ok: true, skipped: true, action: "dispatch" };
  const restaurante = await getRestauranteDoPedido(pedido);
  try {
    const data = await postIfoodOrderAction(restaurante, pedido.externalOrderId, "dispatch", { deliveredBy: "MERCHANT" });
    return { ok: true, action: "dispatch", orderId: pedido.externalOrderId, data };
  } catch (error) {
    return { ...normalizeIfoodActionError(error, "Falha ao despachar pedido no iFood."), action: "dispatch", orderId: pedido.externalOrderId };
  }
}

async function cancellationReasonsForPedido(pedido) {
  if (!isIfoodPedido(pedido)) return [];
  if (/^IFTEST-/i.test(pedido.externalOrderId)) return [
    { code: "503", description: "Item indisponivel" },
    { code: "504", description: "Restaurante sem entregador" },
    { code: "509", description: "Dificuldades internas" },
  ];
  const restaurante = await getRestauranteDoPedido(pedido);
  const data = await getIfoodOrderResource(restaurante, pedido.externalOrderId, "cancellationReasons");
  return Array.isArray(data) ? data : Array.isArray(data?.reasons) ? data.reasons : [];
}

async function solicitarCancelamentoNoIfood(pedido, reason) {
  if (!isIfoodPedido(pedido)) return null;
  const code = safeString(reason, 80);
  if (!code) {
    const error = new Error("Selecione um motivo de cancelamento aceito pelo iFood.");
    error.status = 400;
    throw error;
  }
  if (/^IFTEST-/i.test(pedido.externalOrderId)) return { ok: true, skipped: true, action: "requestCancellation", reason: code };
  const restaurante = await getRestauranteDoPedido(pedido);
  try {
    const data = await postIfoodOrderAction(restaurante, pedido.externalOrderId, "requestCancellation", { reason: code });
    return { ok: true, pending: true, action: "requestCancellation", reason: code, data };
  } catch (error) {
    return { ...normalizeIfoodActionError(error, "Falha ao solicitar cancelamento no iFood."), action: "requestCancellation", reason: code };
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

function isFinalCancellationCode(code = "") {
  return ["can", "cancelled", "canceled", "ordercancelled", "ordercanceled"].includes(normalizeKey(code));
}

function initialLocalStatus(event = {}, order = {}) {
  const code = normalizeKey(event.fullCode || event.code || order.status);
  if (isFinalCancellationCode(code)) return "cancelado";
  if (code.includes("concluded") || code === "con") return "entregue";
  if (code.includes("dispatch") || code.includes("collected") || code === "dsp") return "em_entrega";
  if (code.includes("confirmed") || code === "cfm" || code.includes("preparation")) return "em_producao";
  return "pendente";
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
  const orderType = safeString(pick(order, ["orderType", "type"], "DELIVERY"), 40).toUpperCase();
  const orderTiming = safeString(pick(order, ["orderTiming", "timing"], "IMMEDIATE"), 40).toUpperCase();
  const deliveredBy = safeString(pick(order, ["delivery.deliveredBy", "delivery.deliveryBy"], orderType === "DELIVERY" ? "MERCHANT" : "CUSTOMER"), 40).toUpperCase();
  const deliveryObservations = safeString(pick(order, ["delivery.observations", "delivery.observation", "delivery.instructions"], ""), 800);
  const orderObservations = safeString(pick(order, ["observations", "observation", "extraInfo"], ""), 800);
  const payments = pick(order, ["payments.methods"], []);
  const paymentMethod = Array.isArray(payments) ? payments[0] || {} : {};
  const benefits = pick(order, ["benefits", "discounts", "coupons"], []);
  const descontoValor = round2((Array.isArray(benefits) ? benefits : []).reduce((sum, benefit) => (
    sum + toMoney(pick(benefit, ["value", "amount", "total", "discount.value"], 0))
  ), 0));
  const scheduledToRaw = pick(order, ["scheduling.to", "scheduling.deliveryDateTime", "delivery.deliveryDateTime", "preparationStartDateTime"], null);
  const preparationStartRaw = pick(order, ["preparationStartDateTime", "scheduling.preparationStartDateTime"], null);
  const coordinates = pick(order, ["delivery.deliveryAddress.coordinates", "delivery.address.coordinates"], {}) || {};
  const initialStatus = initialLocalStatus(event, order);

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
    externalOrderType: orderType,
    externalOrderTiming: orderTiming,
    deliveryProvider: deliveredBy,
    pickupCode: safeString(pick(order, ["delivery.pickupCode", "takeout.pickupCode"], ""), 80),
    deliveryLocalizer: safeString(pick(order, ["customer.phone.localizer", "phone.localizer", "delivery.localizer"], ""), 120),
    deliveryObservations,
    scheduledTo: scheduledToRaw ? normalizeDate(scheduledToRaw) : null,
    ifoodPreparationStartAt: preparationStartRaw ? normalizeDate(preparationStartRaw) : null,
    nomeCliente: safeString(pick(customer, ["name", "nome"], "Cliente iFood"), 120),
    telefoneCliente: onlyDigits(pick(customer, ["phone.number", "phone", "phoneNumber"], "")),
    enderecoCliente: normalizeAddress(order),
    residenciaNumero: safeString(pick(order, ["delivery.deliveryAddress.streetNumber", "delivery.address.streetNumber"], ""), 40),
    residenciaComplemento: safeString(pick(order, ["delivery.deliveryAddress.complement", "delivery.address.complement"], ""), 120),
    residenciaReferencia: safeString(pick(order, ["delivery.deliveryAddress.reference", "delivery.address.reference"], ""), 180),
    residenciaBairro: safeString(pick(order, ["delivery.deliveryAddress.neighborhood", "delivery.address.neighborhood"], ""), 120),
    residenciaCep: onlyDigits(pick(order, ["delivery.deliveryAddress.postalCode", "delivery.address.postalCode"], "")),
    latitudeCliente: toNum(pick(coordinates, ["latitude", "lat"], 0)) || 0,
    longitudeCliente: toNum(pick(coordinates, ["longitude", "lng", "lon"], 0)) || 0,
    itens,
    total,
    valorTotal: total,
    totalBruto: total,
    taxaEntrega,
    taxaMarketplace: toMoney(pick(order, ["fees.marketplace", "commission.value", "financial.commission"], 0)),
    valorRepasse: toMoney(pick(order, ["financial.netValue", "settlement.value", "netValue"], 0)),
    descontoValor,
    valorDesconto: descontoValor,
    formaPagamento,
    formadePagamento: formaPagamento,
    status: initialStatus,
    statusPagamento: pago ? "pago" : "pendente",
    valorPago: pago ? total : 0,
    valorPendente: pago ? 0 : total,
    pagoEm: pago ? agora : null,
    aceitoEm: initialStatus === "em_producao" ? agora : null,
    emProducaoEm: initialStatus === "em_producao" ? agora : null,
    emEntregaEm: initialStatus === "em_entrega" ? agora : null,
    entregueEm: initialStatus === "entregue" ? agora : null,
    canceladoEm: initialStatus === "cancelado" ? agora : null,
    criadoEm: normalizeDate(pick(order, ["createdAt", "created_at", "orderCreatedAt"], event.createdAt || Date.now()), agora),
    statusAtualizadoEm: agora,
    pagamentos: pago
      ? [{ metodo: formaPagamento, valor: total, status: "confirmado", recebidoEm: agora, confirmadoEm: agora, recebidoPorRole: "ifood" }]
      : [],
    observacao: safeString([orderObservations, deliveryObservations].filter(Boolean).join(" | "), 1200),
    pagamento: {
      prepaid: pago,
      method: formaPagamento,
      brand: safeString(pick(paymentMethod, ["card.brand", "brand", "cardBrand"], ""), 80),
      changeFor: toMoney(pick(paymentMethod, ["cash.changeFor", "changeFor", "cash.change"], 0)),
      methods: Array.isArray(payments) ? payments : [],
      benefits: Array.isArray(benefits) ? benefits : [],
    },
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
      externalOrderType: normalized.externalOrderType,
      externalOrderTiming: normalized.externalOrderTiming,
      deliveryProvider: normalized.deliveryProvider,
      pickupCode: normalized.pickupCode,
      deliveryLocalizer: normalized.deliveryLocalizer,
      deliveryObservations: normalized.deliveryObservations,
      scheduledTo: normalized.scheduledTo,
      ifoodPreparationStartAt: normalized.ifoodPreparationStartAt,
      nomeCliente: normalized.nomeCliente,
      telefoneCliente: normalized.telefoneCliente,
      enderecoCliente: normalized.enderecoCliente,
      residenciaNumero: normalized.residenciaNumero,
      residenciaComplemento: normalized.residenciaComplemento,
      residenciaReferencia: normalized.residenciaReferencia,
      residenciaBairro: normalized.residenciaBairro,
      residenciaCep: normalized.residenciaCep,
      latitudeCliente: normalized.latitudeCliente,
      longitudeCliente: normalized.longitudeCliente,
      itens: normalized.itens,
      total: normalized.total,
      valorTotal: normalized.valorTotal,
      totalBruto: normalized.totalBruto,
      descontoValor: normalized.descontoValor,
      valorDesconto: normalized.valorDesconto,
      taxaEntrega: normalized.taxaEntrega,
      taxaMarketplace: normalized.taxaMarketplace,
      valorRepasse: normalized.valorRepasse,
      observacao: normalized.observacao,
      pagamento: normalized.pagamento,
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
  try {
    await pedido.save();
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062) {
      const existente = await Pedido.findOne({ restaurante: restauranteId, origem: "ifood", externalOrderId: normalized.externalOrderId });
      if (existente) return { pedido: existente, created: false, duplicate: true };
    }
    throw error;
  }

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

async function updateIfoodEventRecord(event, patch = {}) {
  const eventId = safeString(event?.id || event?.eventId, 191);
  if (!eventId) return null;
  const record = await IfoodEvent.findOne({ eventId });
  if (!record) return null;
  Object.assign(record, patch);
  await record.save();
  return record;
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
      await updateIfoodEventRecord(event, { status: "processado", processadoEm: new Date(), ultimoErro: null }).catch(() => null);
      console.log(`[iFood] Pedido ${orderId} ${result.created ? "criado" : "atualizado"}.`);
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || String(error);
      console.warn(`[iFood] Falha ao importar ${orderId} tentativa ${attempt + 1}:`, message);
      await patchRestauranteIfood(restauranteId, {
        lastError: message,
        ultimoErroEm: new Date(),
      }).catch(() => null);
      await updateIfoodEventRecord(event, { status: "erro", tentativas: attempt + 1, ultimoErro: message }).catch(() => null);
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

  const cancellationRequestFailed = code.includes("cancellationrequestfailed") || code === "crf";
  const cancellationRequested = code === "cancellationrequested" || code === "car";
  if (cancellationRequestFailed || cancellationRequested || isFinalCancellationCode(code)) {
    if (cancellationRequestFailed) {
      const pedido = await updateExistingOrderStatus(event, restaurante, {
        ifoodCancellationStatus: "falhou",
        ifoodCancellationReason: safeString(event.metadata?.reason || event.metadata?.reasonDescription || "Cancelamento rejeitado pelo iFood", 255),
      });
      if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
      return { ok: true, accepted: true, action: "cancellation_failed", pedidoId: pedido?._id || pedido?.id || null };
    }
    if (cancellationRequested) {
      const pedido = await updateExistingOrderStatus(event, restaurante, {
        ifoodCancellationStatus: "solicitado",
        ifoodCancellationReason: safeString(event.metadata?.reason || event.metadata?.reasonDescription || "", 255),
      });
      if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
      return { ok: true, accepted: true, action: "cancellation_requested", pedidoId: pedido?._id || pedido?.id || null };
    }
    const pedido = await updateExistingOrderStatus(event, restaurante, {
      status: "cancelado",
      statusPagamento: "cancelado",
      canceladoEm: new Date(),
      motivoCancelamento: safeString(event.metadata?.cancelReasonDescription || event.metadata?.reasonDescription || "Cancelado no iFood", 255),
      ifoodCancellationStatus: "confirmado",
    });
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "cancel_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("confirmed") || code === "cfm") {
    const pedido = await updateExistingOrderStatus(event, restaurante, { status: "em_producao", aceitoEm: new Date() });
    if (!pedido) scheduleIfoodOrderImport(event, restauranteId, io, 0);
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "confirmed_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("concluded") || code === "con") {
    const pedido = await updateExistingOrderStatus(event, restaurante, { status: "entregue", entregueEm: new Date() });
    if (!pedido) scheduleIfoodOrderImport(event, restauranteId, io, 0);
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "concluded_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("readytopickup") || code === "rtp") {
    const pedido = await updateExistingOrderStatus(event, restaurante, { ifoodReadyAt: new Date() });
    if (!pedido) scheduleIfoodOrderImport(event, restauranteId, io, 0);
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "ready_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("dispatched") || code === "dsp" || code.includes("collected")) {
    const pedido = await updateExistingOrderStatus(event, restaurante, {
      status: "em_entrega",
      emEntregaEm: new Date(),
      ifoodDispatchedAt: new Date(),
    });
    if (!pedido) scheduleIfoodOrderImport(event, restauranteId, io, 0);
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "dispatched_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("assigndriver") || code.includes("goingtoorigin") || code.includes("arrivedatorigin") || code.includes("arrivedatdestination")) {
    const existing = await Pedido.findOne({ restaurante: restauranteId, origem: "ifood", externalOrderId: safeString(event.orderId || event.metadata?.id || event.metadata?.orderId, 191) });
    const driver = { ...(existing?.ifoodDriver || {}), ...(event.metadata || {}), lastEvent: event.fullCode || event.code || "", updatedAt: new Date() };
    const pedido = await updateExistingOrderStatus(event, restaurante, { ifoodDriver: driver });
    if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
    return { ok: true, accepted: true, action: "driver_updated", pedidoId: pedido?._id || pedido?.id || null };
  }

  if (code.includes("orderpatched") || code.includes("addresschange") || code.includes("phonechange")) {
    scheduleIfoodOrderImport(event, restauranteId, io, 0);
    return { ok: true, accepted: true, action: "refresh_scheduled" };
  }

  const pedido = await updateExistingOrderStatus(event, restaurante).catch(() => null);
  if (pedido) io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
  await patchRestauranteIfood(restauranteId, {
    ultimoEventoRecebidoEm: new Date(),
    ultimoEventoCodigo: event.fullCode || event.code || "",
  }).catch(() => null);
  return { ok: true, ignored: true, action: "event_registered" };
}

async function recuperarEventosIfoodPendentes(io = null) {
  const registros = await IfoodEvent.find({ status: { $in: ["recebido", "agendado", "erro"] } })
    .sort({ recebidoEm: 1 })
    .limit(100);
  let recuperados = 0;
  for (const registro of registros) {
    const event = registro.payload && typeof registro.payload === "object" ? registro.payload : {};
    if (!event.id && registro.eventId) event.id = registro.eventId;
    if (!event.merchantId && registro.merchantId) event.merchantId = registro.merchantId;
    if (!event.orderId && registro.orderId) event.orderId = registro.orderId;
    try {
      await processQueuedIfoodEvent(event, io);
      recuperados += 1;
    } catch (error) {
      registro.status = "erro";
      registro.tentativas = Number(registro.tentativas || 0) + 1;
      registro.ultimoErro = safeString(error?.message || error, 1000);
      await registro.save().catch(() => null);
    }
  }
  if (recuperados) console.log(`[iFood] ${recuperados} evento(s) pendente(s) retomado(s).`);
  return { recuperados, encontrados: registros.length };
}

async function processQueuedIfoodEvent(event, io = null) {
  const eventId = safeString(event?.id || event?.eventId, 191);
  const record = eventId ? await IfoodEvent.findOne({ eventId }) : null;
  if (record && String(record.status || "") === "processado") return { ok: true, duplicate: true, eventId };
  if (record) {
    record.status = "processando";
    record.tentativas = Number(record.tentativas || 0) + 1;
    record.ultimoErro = null;
    await record.save();
  }
  try {
    const result = await processIfoodEvent(event, io);
    if (record) {
      const restaurante = await findRestauranteByMerchant(event.merchantId || event.metadata?.merchantId || event.payload?.merchantId);
      record.restauranteId = restaurante?._id || restaurante?.id || null;
      record.status = result?.action === "import_scheduled" || result?.action === "refresh_scheduled" ? "agendado" : "processado";
      record.processadoEm = record.status === "processado" ? new Date() : null;
      await record.save();
    }
    return result;
  } catch (error) {
    if (record) {
      record.status = "erro";
      record.ultimoErro = safeString(error?.response?.data?.message || error?.message || error, 2000);
      await record.save().catch(() => null);
    }
    throw error;
  }
}

async function activeMerchantIds(requestedIds = []) {
  const wanted = new Set((requestedIds || []).map((id) => safeString(id, 191)).filter(Boolean));
  if (!wanted.size) return [];
  const restaurantes = await Restaurante.find({ ifoodStatus: true }).lean();
  const active = new Set();
  for (const restaurante of restaurantes) {
    const ifood = parseJsonSafe(restaurante.ifood, {});
    const ids = [restaurante.ifoodIdentificador, ifood.merchantId, ...(Array.isArray(ifood.merchantIds) ? ifood.merchantIds : [])];
    ids.map((id) => safeString(id, 191)).filter((id) => wanted.has(id)).forEach((id) => active.add(id));
  }
  return [...active];
}

async function persistPollingEvent(event) {
  const eventId = safeString(event?.id || event?.eventId, 191);
  if (!eventId) return { record: null, duplicate: false };
  const existing = await IfoodEvent.findOne({ eventId });
  if (existing) return { record: existing, duplicate: true };
  try {
    const record = new IfoodEvent({
      eventId,
      merchantId: safeString(event.merchantId || event.metadata?.merchantId, 191),
      orderId: safeString(event.orderId || event.metadata?.orderId, 191),
      code: safeString(event.fullCode || event.code, 120),
      payload: event,
      status: "recebido",
      tentativas: 0,
      recebidoEm: new Date(),
    });
    await record.save();
    return { record, duplicate: false };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062) {
      return { record: await IfoodEvent.findOne({ eventId }), duplicate: true };
    }
    throw error;
  }
}

let pollingRunning = false;
async function pollIfoodEvents(io = null) {
  if (pollingRunning) return { skipped: true, reason: "already_running" };
  pollingRunning = true;
  let lojas = 0;
  let eventosRecebidos = 0;
  try {
    const restaurantes = await Restaurante.find({ ifoodStatus: true }).lean();
    for (const restaurante of restaurantes) {
      const ifood = parseJsonSafe(restaurante.ifood, {});
      const merchantId = safeString(restaurante.ifoodIdentificador || ifood.merchantId, 191);
      if (!merchantId || ifood.conectado === false) continue;
      lojas += 1;
      try {
        const token = await getTokenForRestaurante(restaurante);
        const response = await axios.get(`${API_BASE_URL}/events/v1.0/events:polling`, {
          timeout: 12000,
          validateStatus: (status) => status === 200 || status === 204,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "x-polling-merchants": merchantId,
          },
        });
        const events = Array.isArray(response.data) ? response.data : [];
        if (!events.length) continue;
        eventosRecebidos += events.length;
        const persisted = [];
        for (const event of events) {
          const saved = await persistPollingEvent(event);
          if (saved.record) persisted.push(event);
        }
        await axios.post(
          `${API_BASE_URL}/events/v1.0/events/acknowledgment`,
          events.map((event) => ({ id: event.id })).filter((event) => event.id),
          { timeout: 12000, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" } }
        );
        persisted.forEach((event) => {
          setImmediate(() => processQueuedIfoodEvent(event, io).catch((error) => {
            console.error(`[iFood polling] Falha no evento ${event.id}:`, error?.response?.data || error?.message || error);
          }));
        });
        await patchRestauranteIfood(restaurante._id || restaurante.id, { ultimoPollingEm: new Date(), lastError: null }).catch(() => null);
      } catch (error) {
        const message = error?.response?.data?.message || error?.message || String(error);
        console.error(`[iFood polling] Loja ${merchantId}:`, message);
        await patchRestauranteIfood(restaurante._id || restaurante.id, { lastError: message, ultimoErroEm: new Date() }).catch(() => null);
      }
    }
    return { lojas, eventosRecebidos };
  } finally {
    pollingRunning = false;
  }
}

let pollingTimer = null;
function startIfoodPolling(io = null) {
  if (pollingTimer || normalizeKey(process.env.IFOOD_ENABLE_POLLING || "true") === "false") return pollingTimer;
  const intervalMs = Math.max(30000, Number(process.env.IFOOD_POLLING_INTERVAL_MS || 30000));
  setImmediate(() => pollIfoodEvents(io).catch((error) => console.error("[iFood polling]", error?.message || error)));
  pollingTimer = setInterval(() => pollIfoodEvents(io).catch((error) => console.error("[iFood polling]", error?.message || error)), intervalMs);
  pollingTimer.unref?.();
  console.log(`[iFood] Polling de eventos ativo a cada ${Math.round(intervalMs / 1000)}s.`);
  return pollingTimer;
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
      ultimoPollingEm: ifood.ultimoPollingEm || null,
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
    if (merchantIdManual && merchantIds.length && !merchantIds.includes(merchantIdManual)) {
      return res.status(422).json({ ok: false, message: "O merchantId informado nao pertence a autorizacao recebida do iFood." });
    }
    const merchantId = merchantIdManual || merchantIds[0] || ifood.merchantId || restaurante.ifoodIdentificador || "";
    if (!merchantId) return res.status(422).json({ ok: false, message: "O iFood nao retornou um merchantId para esta loja." });
    const vinculoExistente = await Restaurante.findOne({ ifoodIdentificador: merchantId });
    if (vinculoExistente && String(vinculoExistente._id || vinculoExistente.id) !== restauranteId) {
      return res.status(409).json({ ok: false, message: "Esta loja iFood ja esta vinculada a outro restaurante MOVYO." });
    }
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
      const code = normalizeKey(event?.fullCode || event?.code);
      if (code === "keepalive") {
        const merchantIds = await activeMerchantIds(event?.merchantIds || []);
        return res.status(202).json({ merchantIds });
      }
      const eventId = safeString(event?.id || event?.eventId, 191) || crypto.createHash("sha256").update(JSON.stringify(event || {})).digest("hex");
      event.id = eventId;
      let record = await IfoodEvent.findOne({ eventId });
      if (record && String(record.status || "") === "processado") {
        results.push({ ok: true, duplicate: true, eventId });
        continue;
      }
      if (!record) {
        try {
          record = new IfoodEvent({
            eventId,
            merchantId: safeString(event.merchantId || event.metadata?.merchantId || event.payload?.merchantId, 191),
            orderId: safeString(event.orderId || event.metadata?.id || event.metadata?.orderId, 191),
            code: safeString(event.fullCode || event.code || event.eventType || event.type, 120),
            payload: event,
            status: "recebido",
            tentativas: 0,
            recebidoEm: new Date(),
          });
          await record.save();
        } catch (createError) {
          if (createError?.code === "ER_DUP_ENTRY" || Number(createError?.errno) === 1062) {
            results.push({ ok: true, duplicate: true, eventId });
            continue;
          }
          throw createError;
        }
      } else {
        if (String(record.status || "") === "processando") {
          results.push({ ok: true, duplicate: true, processing: true, eventId });
          continue;
        }
      }
      setImmediate(() => processQueuedIfoodEvent(event, req.io).catch((eventError) => {
        console.error(`[iFood webhook] Falha no evento ${eventId}:`, eventError?.response?.data || eventError?.message || eventError);
      }));
      results.push({ ok: true, accepted: true, eventId });
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

async function pedidoIfoodAutenticado(req, res) {
  const restauranteId = String(req.restauranteId || req.userId || "");
  const pedido = await Pedido.findById(req.params.pedidoId);
  if (!pedido) {
    res.status(404).json({ ok: false, message: "Pedido nao encontrado." });
    return null;
  }
  if (String(pedido.restaurante?._id || pedido.restaurante) !== restauranteId) {
    res.status(403).json({ ok: false, message: "Pedido pertence a outro restaurante." });
    return null;
  }
  if (!isIfoodPedido(pedido)) {
    res.status(409).json({ ok: false, message: "Este pedido nao e do iFood." });
    return null;
  }
  return pedido;
}

exports.marcarPronto = async (req, res) => {
  try {
    const pedido = await pedidoIfoodAutenticado(req, res);
    if (!pedido) return;
    const result = await marcarPedidoProntoNoIfood(pedido);
    pedido.ifoodReadyAt = new Date();
    pedido.externalStatus = "READY_TO_PICKUP";
    pedido.statusAtualizadoEm = new Date();
    await pedido.save();
    req.io?.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", pedido);
    return res.json({ ok: true, pedido, ifood: result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.message, ifood: error.details || null });
  }
};

exports.cancellationReasons = async (req, res) => {
  try {
    const pedido = await pedidoIfoodAutenticado(req, res);
    if (!pedido) return;
    const reasons = await cancellationReasonsForPedido(pedido);
    return res.json({ ok: true, reasons });
  } catch (error) {
    return res.status(error.status || error?.response?.status || 500).json({ ok: false, message: error?.response?.data?.message || error.message });
  }
};

exports.tracking = async (req, res) => {
  try {
    const pedido = await pedidoIfoodAutenticado(req, res);
    if (!pedido) return;
    if (normalizeKey(pedido.deliveryProvider) !== "ifood") return res.status(409).json({ ok: false, message: "Rastreio iFood disponivel apenas quando a entrega e feita pelo iFood." });
    const lastTrackingAt = pedido.ifoodTracking?.consultadoEm ? new Date(pedido.ifoodTracking.consultadoEm).getTime() : 0;
    if (Number.isFinite(lastTrackingAt) && Date.now() - lastTrackingAt < 30000) {
      return res.json({ ok: true, cached: true, tracking: pedido.ifoodTracking });
    }
    const restaurante = await getRestauranteDoPedido(pedido);
    const trackingData = /^IFTEST-/i.test(pedido.externalOrderId)
      ? { test: true, message: "Rastreio simulado para pedido de teste." }
      : await getIfoodOrderResource(restaurante, pedido.externalOrderId, "tracking");
    const tracking = { ...(trackingData || {}), consultadoEm: new Date() };
    pedido.ifoodTracking = tracking;
    await pedido.save();
    return res.json({ ok: true, tracking });
  } catch (error) {
    return res.status(error.status || error?.response?.status || 500).json({ ok: false, message: error?.response?.data?.message || error.message });
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
  initialLocalStatus,
  marcarPedidoProntoNoIfood,
  iniciarPreparoNoIfood,
  despacharPedidoNoIfood,
  solicitarCancelamentoNoIfood,
  cancellationReasonsForPedido,
  recuperarEventosIfoodPendentes,
  processQueuedIfoodEvent,
  activeMerchantIds,
  persistPollingEvent,
  pollIfoodEvents,
};

exports.confirmarPedidoNoIfood = confirmarPedidoNoIfood;
exports.marcarPedidoProntoNoIfood = marcarPedidoProntoNoIfood;
exports.iniciarPreparoNoIfood = iniciarPreparoNoIfood;
exports.despacharPedidoNoIfood = despacharPedidoNoIfood;
exports.recuperarEventosIfoodPendentes = recuperarEventosIfoodPendentes;
exports.startIfoodPolling = startIfoodPolling;
exports.solicitarCancelamentoNoIfood = solicitarCancelamentoNoIfood;
exports.cancellationReasonsForPedido = cancellationReasonsForPedido;
