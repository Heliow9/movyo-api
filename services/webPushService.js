const crypto = require('crypto');
const axios = require('axios');
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const { formatOperationalTimeBR } = require('../utils/operationalDateTime');

let configuredSignature = '';
let warnedMissingConfig = false;
const recentEvents = new Map();
const RECENT_EVENT_TTL_MS = Number(process.env.WEB_PUSH_DEDUP_TTL_MS || 20_000);
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function getConfig() {
  return {
    subject: clean(process.env.WEB_PUSH_SUBJECT || 'mailto:suporte@movyo.delivery'),
    publicKey: clean(process.env.WEB_PUSH_PUBLIC_KEY),
    privateKey: clean(process.env.WEB_PUSH_PRIVATE_KEY),
  };
}

function configureWebPush() {
  const config = getConfig();
  if (!config.publicKey || !config.privateKey) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn('🔕 Web Push desativado: configure WEB_PUSH_PUBLIC_KEY e WEB_PUSH_PRIVATE_KEY.');
    }
    return { ok: false, ...config };
  }

  const signature = `${config.subject}|${config.publicKey}|${config.privateKey}`;
  if (configuredSignature !== signature) {
    try {
      webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
      configuredSignature = signature;
      warnedMissingConfig = false;
      console.log('🔔 Web Push VAPID configurado.');
    } catch (error) {
      configuredSignature = '';
      console.error('🔕 Configuração VAPID inválida:', error?.message || error);
      return { ok: false, reason: 'VAPID_INVALIDO', error: error?.message, ...config };
    }
  }

  return { ok: true, ...config };
}

function getPublicKey() {
  return getConfig().publicKey;
}

function isConfigured() {
  return configureWebPush().ok;
}

function endpointHash(endpoint) {
  return crypto.createHash('sha256').update(clean(endpoint)).digest('hex');
}

function normalizeRestauranteId(value) {
  if (value && typeof value === 'object') {
    return clean(value._id || value.id || value.restauranteId || value.restaurante);
  }
  return clean(value);
}

function normalizeSubscription(input = {}) {
  const subscription = input && typeof input.toJSON === 'function' ? input.toJSON() : input;
  const endpoint = clean(subscription?.endpoint);
  const p256dh = clean(subscription?.keys?.p256dh || subscription?.p256dh);
  const auth = clean(subscription?.keys?.auth || subscription?.auth);

  if (!endpoint || !/^https:\/\//i.test(endpoint)) {
    const error = new Error('Inscrição Web Push inválida: endpoint HTTPS ausente.');
    error.status = 400;
    throw error;
  }
  if (!p256dh || !auth) {
    const error = new Error('Inscrição Web Push inválida: chaves p256dh/auth ausentes.');
    error.status = 400;
    throw error;
  }

  let expirationTime = null;
  if (subscription?.expirationTime) {
    const parsed = new Date(subscription.expirationTime);
    if (!Number.isNaN(parsed.getTime())) expirationTime = parsed;
  }

  return { endpoint, p256dh, auth, expirationTime };
}

async function saveSubscription({
  restauranteId,
  usuarioId,
  role,
  subscription,
  plataforma,
  standalone,
  userAgent,
}) {
  const restId = normalizeRestauranteId(restauranteId);
  if (!restId) {
    const error = new Error('restauranteId é obrigatório para salvar a inscrição push.');
    error.status = 400;
    throw error;
  }

  const normalized = normalizeSubscription(subscription);
  const hash = endpointHash(normalized.endpoint);
  let doc = await PushSubscription.findOne({ endpointHash: hash });

  if (!doc) doc = new PushSubscription({ endpointHash: hash });
  doc.restauranteId = restId;
  doc.usuarioId = clean(usuarioId);
  doc.role = clean(role || 'restaurante');
  doc.endpoint = normalized.endpoint;
  doc.p256dh = normalized.p256dh;
  doc.auth = normalized.auth;
  doc.expirationTime = normalized.expirationTime;
  doc.plataforma = clean(plataforma || 'web-pwa');
  doc.standalone = standalone === true;
  doc.userAgent = clean(userAgent).slice(0, 4000);
  doc.ativo = true;
  doc.ultimaSincronizacaoEm = new Date();
  doc.falhasConsecutivas = 0;
  doc.ultimoErro = '';
  await doc.save();
  return doc;
}

function normalizeExpoPushToken(value) {
  const token = clean(value);
  if (!/^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(token)) {
    const error = new Error('Token Expo Push invalido.');
    error.status = 400;
    error.code = 'EXPO_PUSH_TOKEN_INVALIDO';
    throw error;
  }
  return token;
}

async function saveNativeSubscription({
  restauranteId,
  usuarioId,
  role,
  pushToken,
  plataforma,
  deviceId,
  userAgent,
}) {
  const restId = normalizeRestauranteId(restauranteId);
  if (!restId) {
    const error = new Error('restauranteId e obrigatorio para salvar o push nativo.');
    error.status = 400;
    throw error;
  }

  const token = normalizeExpoPushToken(pushToken);
  const hash = endpointHash(`expo:${token}`);
  let doc = await PushSubscription.findOne({ endpointHash: hash });
  if (!doc) doc = new PushSubscription({ endpointHash: hash });

  doc.restauranteId = restId;
  doc.usuarioId = clean(usuarioId);
  doc.role = clean(role || 'restaurante');
  doc.endpoint = '';
  doc.p256dh = '';
  doc.auth = '';
  doc.pushProvider = 'expo';
  doc.pushToken = token;
  doc.deviceId = clean(deviceId);
  doc.plataforma = clean(plataforma || 'android-native');
  doc.standalone = true;
  doc.userAgent = clean(userAgent).slice(0, 4000);
  doc.ativo = true;
  doc.ultimaSincronizacaoEm = new Date();
  doc.falhasConsecutivas = 0;
  doc.ultimoErro = '';
  await doc.save();
  return doc;
}

async function removeSubscription({ restauranteId, endpoint }) {
  const restId = normalizeRestauranteId(restauranteId);
  const hash = endpointHash(endpoint);
  const doc = await PushSubscription.findOne({ endpointHash: hash });
  if (!doc || String(doc.restauranteId) !== String(restId)) return false;
  doc.ativo = false;
  doc.ultimaSincronizacaoEm = new Date();
  await doc.save();
  return true;
}

async function removeNativeSubscription({ restauranteId, pushToken }) {
  const restId = normalizeRestauranteId(restauranteId);
  const token = normalizeExpoPushToken(pushToken);
  const doc = await PushSubscription.findOne({ endpointHash: endpointHash(`expo:${token}`) });
  if (!doc || String(doc.restauranteId) !== String(restId)) return false;
  doc.ativo = false;
  doc.ultimaSincronizacaoEm = new Date();
  await doc.save();
  return true;
}

function toWebPushSubscription(doc) {
  return {
    endpoint: doc.endpoint,
    expirationTime: doc.expirationTime ? new Date(doc.expirationTime).getTime() : null,
    keys: {
      p256dh: doc.p256dh,
      auth: doc.auth,
    },
  };
}

function trimError(error) {
  return clean(error?.body || error?.message || error).slice(0, 2000);
}

async function markSuccess(doc) {
  await PushSubscription.findByIdAndUpdate(doc._id, {
    $set: {
      ativo: true,
      ultimoSucessoEm: new Date(),
      falhasConsecutivas: 0,
      ultimoErro: '',
    },
  }).catch((error) => console.warn('Falha ao registrar sucesso do push:', error?.message || error));
}

async function markFailure(doc, error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const falhas = Number(doc.falhasConsecutivas || 0) + 1;
  const pushCode = clean(error?.pushCode || error?.response?.data?.details?.error);
  const expirou = statusCode === 404 || statusCode === 410 || pushCode === 'DeviceNotRegistered';
  const deveDesativar = expirou || falhas >= Number(process.env.WEB_PUSH_MAX_FAILURES || 5);

  await PushSubscription.findByIdAndUpdate(doc._id, {
    $set: {
      ativo: !deveDesativar,
      ultimaFalhaEm: new Date(),
      falhasConsecutivas: falhas,
      ultimoErro: trimError(error),
    },
  }).catch((updateError) => console.warn('Falha ao registrar erro do push:', updateError?.message || updateError));

  return { statusCode, pushCode, expirou, desativado: deveDesativar };
}

function wasRecentlySent(key) {
  const now = Date.now();
  for (const [eventKey, expiresAt] of recentEvents.entries()) {
    if (expiresAt <= now) recentEvents.delete(eventKey);
  }
  const current = recentEvents.get(key);
  if (current && current > now) return true;
  recentEvents.set(key, now + RECENT_EVENT_TTL_MS);
  return false;
}

async function sendToRestaurant(restauranteId, payload, options = {}) {
  const restId = normalizeRestauranteId(restauranteId);
  if (!restId) return { ok: false, reason: 'RESTAURANTE_AUSENTE', total: 0, enviados: 0 };

  const eventKey = clean(options.eventKey);
  if (eventKey && wasRecentlySent(`${restId}:${eventKey}`)) {
    return { ok: true, deduplicado: true, total: 0, enviados: 0 };
  }

  const subscriptions = await PushSubscription.find({ restauranteId: restId, ativo: true }).lean();
  if (!subscriptions.length) return { ok: true, total: 0, enviados: 0, semInscricoes: true };

  const config = configureWebPush();
  const json = JSON.stringify(payload || {});
  const ttl = Math.max(0, Number(options.ttl ?? process.env.WEB_PUSH_TTL_SECONDS ?? 120));
  const urgency = clean(options.urgency || 'high');

  const results = await Promise.all(subscriptions.map(async (doc) => {
    try {
      const provider = clean(doc.pushProvider).toLowerCase();
      const pushToken = clean(doc.pushToken);
      if (provider === 'expo' || pushToken) {
        const response = await axios.post(EXPO_PUSH_ENDPOINT, {
          to: normalizeExpoPushToken(pushToken),
          title: clean(payload?.title || 'Movyo'),
          body: clean(payload?.body),
          sound: 'default',
          priority: urgency === 'high' ? 'high' : 'default',
          channelId: 'movyo-operacional',
          ttl,
          data: {
            ...(payload?.data && typeof payload.data === 'object' ? payload.data : {}),
            status: payload?.status || payload?.data?.status || '',
            tag: payload?.tag || '',
          },
        }, {
          timeout: Number(process.env.EXPO_PUSH_TIMEOUT_MS || 10000),
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
        });
        const ticket = Array.isArray(response?.data?.data) ? response.data.data[0] : response?.data?.data;
        if (ticket?.status === 'error') {
          const error = new Error(ticket?.message || 'Expo Push recusou a notificacao.');
          error.pushCode = ticket?.details?.error || 'EXPO_PUSH_ERROR';
          throw error;
        }
      } else {
        if (!config.ok) {
          return { ok: false, id: doc._id, reason: 'VAPID_NAO_CONFIGURADO', provider: 'web' };
        }
        await webpush.sendNotification(toWebPushSubscription(doc), json, { TTL: ttl, urgency });
      }
      await markSuccess(doc);
      return { ok: true, id: doc._id, provider: provider || 'web' };
    } catch (error) {
      const failure = await markFailure(doc, error);
      console.warn(`🔕 Falha Web Push restaurante=${restId} status=${failure.statusCode || 'n/a'}:`, trimError(error));
      return { ok: false, id: doc._id, ...failure };
    }
  }));

  const enviados = results.filter((item) => item.ok).length;
  const desativados = results.filter((item) => item.desativado).length;
  const nativeEnviados = results.filter((item) => item.ok && item.provider === 'expo').length;
  const webEnviados = results.filter((item) => item.ok && item.provider !== 'expo').length;
  const vapidAusente = results.length > 0 && results.every((item) => item.reason === 'VAPID_NAO_CONFIGURADO');
  return {
    ok: enviados > 0,
    reason: vapidAusente ? 'VAPID_NAO_CONFIGURADO' : undefined,
    total: subscriptions.length,
    enviados,
    nativeEnviados,
    webEnviados,
    falhas: subscriptions.length - enviados,
    desativados,
  };
}

function normalizeStatus(status) {
  return clean(status).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
}

function formatMoney(value) {
  let normalized = String(value ?? 0).trim().replace(/\s/g, '').replace(/R\$/gi, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const number = Number(normalized);
  if (!Number.isFinite(number)) return '';
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pedidoIdOf(pedido) {
  return clean(pedido?._id || pedido?.id);
}

function restauranteIdOfPedido(pedido) {
  return normalizeRestauranteId(pedido?.restauranteId || pedido?.restaurante);
}

function formatTimeBR(value) {
  return value ? formatOperationalTimeBR(value) : '';
}

function buildPedidoEmProducaoPayload(pedido = {}) {
  const pedidoId = pedidoIdOf(pedido);
  const codigo = clean(pedido.numeroPedido || pedido.numero || pedido.codigo || pedidoId.slice(-6));
  const cliente = clean(pedido.nomeCliente || pedido?.cliente?.nome || pedido.cliente || 'Cliente');
  const total = formatMoney(pedido.total ?? pedido.valorTotal ?? pedido.valor);
  const bodyParts = [];
  if (codigo) bodyParts.push(`#${codigo}`);
  if (cliente) bodyParts.push(cliente);
  if (total) bodyParts.push(`R$ ${total}`);

  return {
    title: 'Pedido entrou em produção',
    body: bodyParts.join(' • ') || 'Um pedido entrou em produção.',
    tag: `pedido-${codigo || pedidoId || 'movyo'}-producao`,
    // Quando o Hub está aberto, a notificação local do socket usa a mesma tag.
    // Sem renotify, o push remoto apenas substitui o aviso e evita toque duplicado.
    renotify: false,
    status: 'em_producao',
    pedidoId,
    pedido: {
      _id: pedidoId,
      numeroPedido: codigo,
      nomeCliente: cliente,
      total: total || undefined,
      status: 'em_producao',
      origem: pedido.origem || undefined,
    },
    data: {
      url: '/',
      screen: 'Pedidos',
      pedidoId,
      status: 'em_producao',
    },
  };
}

async function notifyPedidoEmProducao(pedido = {}) {
  if (normalizeStatus(pedido.status) !== 'em_producao') {
    return { ok: false, reason: 'STATUS_NAO_E_PRODUCAO', total: 0, enviados: 0 };
  }
  const restId = restauranteIdOfPedido(pedido);
  const pedidoId = pedidoIdOf(pedido);
  return sendToRestaurant(restId, buildPedidoEmProducaoPayload(pedido), {
    eventKey: `pedido:${pedidoId}:em_producao`,
    ttl: 180,
    urgency: 'high',
  });
}

function buildCaixaAbertoPayload(caixa = {}) {
  const caixaId = clean(caixa._id || caixa.id);
  const operador = clean(caixa.operadorNome || caixa?.operador?.nome || 'Operador');
  const hora = formatTimeBR(caixa.abertoEm || new Date());

  return {
    title: 'Caixa aberto na Movyo',
    body: `${operador} abriu o caixa${hora ? ` às ${hora}` : ''}.`,
    tag: `caixa-aberto-${caixaId || 'movyo'}`,
    renotify: false,
    status: 'caixa_aberto',
    data: {
      url: '/',
      screen: 'Home',
      caixaId,
      status: 'caixa_aberto',
    },
  };
}

function buildCaixaFechadoPayload(caixa = {}) {
  const caixaId = clean(caixa._id || caixa.id);
  const operador = clean(caixa.operadorNome || caixa?.operador?.nome || 'Operador');
  const hora = formatTimeBR(caixa.fechadoEm || new Date());
  const valorFinal = formatMoney(
    caixa.saldoFinalInformado ?? caixa.totalEsperadoDinheiro ?? caixa.totalVendas ?? 0
  );
  const totalVendas = formatMoney(caixa.totalVendas ?? 0);
  const bodyParts = [`${operador} fechou o caixa${hora ? ` às ${hora}` : ''}.`];
  bodyParts.push(`Valor final: R$ ${valorFinal}.`);
  if (totalVendas !== valorFinal) bodyParts.push(`Vendas: R$ ${totalVendas}.`);

  return {
    title: 'Caixa fechado na Movyo',
    body: bodyParts.join(' '),
    tag: `caixa-fechado-${caixaId || 'movyo'}`,
    renotify: false,
    status: 'caixa_fechado',
    data: {
      url: '/',
      screen: 'Home',
      caixaId,
      status: 'caixa_fechado',
      saldoFinalInformado: Number(caixa.saldoFinalInformado ?? 0),
      totalEsperadoDinheiro: Number(caixa.totalEsperadoDinheiro ?? 0),
      totalVendas: Number(caixa.totalVendas ?? 0),
    },
  };
}

async function notifyCaixaAberto(caixa = {}) {
  const restId = normalizeRestauranteId(caixa.restauranteId || caixa.restaurante);
  const caixaId = clean(caixa._id || caixa.id);
  return sendToRestaurant(restId, buildCaixaAbertoPayload(caixa), {
    eventKey: `caixa:${caixaId}:aberto`,
    ttl: 120,
    urgency: 'high',
  });
}

async function notifyCaixaFechado(caixa = {}) {
  const restId = normalizeRestauranteId(caixa.restauranteId || caixa.restaurante);
  const caixaId = clean(caixa._id || caixa.id);
  return sendToRestaurant(restId, buildCaixaFechadoPayload(caixa), {
    eventKey: `caixa:${caixaId}:fechado`,
    ttl: 120,
    urgency: 'high',
  });
}

async function getRestaurantStatus(restauranteId) {
  const restId = normalizeRestauranteId(restauranteId);
  const subscriptions = await PushSubscription.find({ restauranteId: restId }).lean();
  return {
    configured: (!!getConfig().publicKey && !!getConfig().privateKey)
      || subscriptions.some((item) => clean(item.pushToken)),
    webConfigured: !!getConfig().publicKey && !!getConfig().privateKey,
    nativeConfigured: subscriptions.some((item) => clean(item.pushToken) && item.ativo !== false),
    total: subscriptions.length,
    ativas: subscriptions.filter((item) => item.ativo !== false).length,
    plataformas: [...new Set(subscriptions.filter((item) => item.ativo !== false).map((item) => item.plataforma).filter(Boolean))],
    ultimaSincronizacaoEm: subscriptions
      .map((item) => item.ultimaSincronizacaoEm)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null,
  };
}

module.exports = {
  getPublicKey,
  isConfigured,
  normalizeSubscription,
  saveSubscription,
  saveNativeSubscription,
  removeSubscription,
  removeNativeSubscription,
  sendToRestaurant,
  buildPedidoEmProducaoPayload,
  notifyPedidoEmProducao,
  buildCaixaAbertoPayload,
  notifyCaixaAberto,
  buildCaixaFechadoPayload,
  notifyCaixaFechado,
  getRestaurantStatus,
};
