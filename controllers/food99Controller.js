// controllers/food99Controller.js
// Integração 99Food / Open Delivery: recebe pedido externo e grava no fluxo padrão Movyo.
const crypto = require('crypto');

const Restaurante = require('../models/Restaurante');
const Pedido = require('../models/Pedido');
const { queryWithRetry } = require('../lib/mysqlRetry');
const {
  getCaixaAberto,
  vincularPedidoAoCaixa,
  registrarMovimentoVenda,
  recalcularCaixa,
  round2,
  toNum,
} = require('../services/caixaService');

function normalizeKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function getByPath(obj, path) {
  return String(path || '').split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function pick(obj, paths = [], fallback = undefined) {
  for (const path of paths) {
    const value = getByPath(obj, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function safeString(v, max = 255) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return max ? s.slice(0, max) : s;
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function parseJsonSafe(value, fallback = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function isTrue(v) {
  if (v === true || v === 1) return true;
  const s = normalizeKey(v);
  return ['true', '1', 'sim', 'yes', 'on', 'ativo', 'active'].includes(s);
}

function extractHeaderToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const bearer = String(auth).match(/^Bearer\s+(.+)$/i)?.[1];
  return safeString(
    req.headers['x-99food-token'] ||
    req.headers['x-food99-token'] ||
    req.headers['x-movyo-99food-token'] ||
    req.headers['x-webhook-token'] ||
    req.query?.token ||
    bearer ||
    '',
    500
  );
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!aa.length || !bb.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function toMoney(raw, opts = {}) {
  if (raw === undefined || raw === null || raw === '') return 0;
  let value = raw;
  if (typeof value === 'object') {
    value = value.value ?? value.amount ?? value.total ?? value.price ?? value.centAmount ?? 0;
  }
  const n = toNum(value);
  if (!Number.isFinite(n)) return 0;

  // Alguns providers/Open Delivery enviam valores em centavos. Mantemos flexível por ENV/config.
  const centsMode = opts.valoresEmCentavos;
  if (centsMode === true || centsMode === 'true') return round2(n / 100);
  if (centsMode === false || centsMode === 'false') return round2(n);

  // Heurística conservadora: valores inteiros muito altos para comida geralmente são centavos.
  if (Number.isInteger(n) && Math.abs(n) >= 1000 && Math.abs(n) % 5 === 0) return round2(n / 100);
  return round2(n);
}

function extractMoney(payload, paths, opts = {}) {
  const value = pick(payload, paths, null);
  return toMoney(value, opts);
}

function normalizeItems(payload = {}, opts = {}) {
  const rawItems =
    pick(payload, ['items', 'itens', 'order.items', 'pedido.itens', 'details.items', 'cart.items'], []) || [];

  const list = Array.isArray(rawItems) ? rawItems : [];
  return list.map((item, index) => {
    const quantidade = Math.max(1, toNum(pick(item, ['quantity', 'quantidade', 'amount', 'qtd'], 1)) || 1);
    const totalItem = toMoney(pick(item, ['totalPrice', 'total', 'price.total', 'prices.total', 'subtotal'], 0), opts);
    const unit = toMoney(pick(item, ['unitPrice', 'price', 'valorUnitario', 'unit.value', 'unitPrice.value'], 0), opts);
    const precoUnitario = unit > 0 ? unit : round2(totalItem / quantidade);
    const precoTotal = totalItem > 0 ? totalItem : round2(precoUnitario * quantidade);

    const complements = pick(item, ['options', 'complements', 'garnishItems', 'subItems', 'modifiers'], []);
    const complementos = Array.isArray(complements)
      ? complements.map((c) => ({
          nome: safeString(pick(c, ['name', 'nome', 'description', 'descricao'], 'Complemento'), 180),
          quantidade: Math.max(1, toNum(pick(c, ['quantity', 'quantidade', 'amount', 'qtd'], 1)) || 1),
          preco: toMoney(pick(c, ['price', 'unitPrice', 'total', 'value'], 0), opts),
        }))
      : [];

    const observacoes = [
      pick(item, ['observations', 'observation', 'observacao', 'note', 'notes'], ''),
      complementos.length ? `Complementos: ${complementos.map((c) => `${c.quantidade}x ${c.nome}`).join(', ')}` : '',
    ].filter(Boolean).join(' | ');

    return {
      idExterno: safeString(pick(item, ['id', 'externalCode', 'sku', 'productId'], `99-${index + 1}`), 120),
      produtoId: safeString(pick(item, ['productId', 'sku', 'externalCode'], ''), 120),
      nome: safeString(pick(item, ['name', 'nome', 'description', 'descricao', 'product.name'], 'Item 99Food'), 180),
      quantidade,
      precoUnitario,
      preco: precoUnitario,
      precoTotal,
      total: precoTotal,
      observacao: safeString(observacoes, 800),
      complementos,
      origem: '99food',
      marketplace: '99food',
    };
  });
}

function normalizeAddress(payload = {}) {
  const addr = pick(payload, ['delivery.deliveryAddress', 'delivery.address', 'address', 'customer.address', 'shipping.address'], {}) || {};
  if (typeof addr === 'string') return safeString(addr, 500);

  const formatted = pick(addr, ['formattedAddress', 'formatted', 'fullAddress', 'address'], '');
  if (formatted) return safeString(formatted, 500);

  const street = safeString(pick(addr, ['streetName', 'street', 'rua', 'logradouro'], ''), 160);
  const number = safeString(pick(addr, ['streetNumber', 'number', 'numero'], ''), 40);
  const neighborhood = safeString(pick(addr, ['neighborhood', 'bairro', 'district'], ''), 120);
  const city = safeString(pick(addr, ['city', 'cidade'], ''), 120);
  const state = safeString(pick(addr, ['state', 'uf', 'estado'], ''), 60);
  const complement = safeString(pick(addr, ['complement', 'complemento'], ''), 120);
  const ref = safeString(pick(addr, ['reference', 'referencia'], ''), 180);
  return [street, number, neighborhood, city, state, complement, ref].filter(Boolean).join(', ').slice(0, 500);
}

function normalizePaymentMethod(payload = {}) {
  const raw = safeString(pick(payload, [
    'payment.method', 'payment.type', 'payments.0.method', 'payments.0.type',
    'order.payment.method', 'paymentMethod', 'formaPagamento', 'payment.name'
  ], 'online'), 120);
  const key = normalizeKey(raw);
  if (key.includes('pix')) return 'pix';
  if (key.includes('debito') || key.includes('debit')) return 'debito';
  if (key.includes('credito') || key.includes('credit') || key.includes('cartao') || key.includes('card')) return 'credito';
  if (key.includes('cash') || key.includes('dinheiro')) return 'dinheiro';
  return '99food_online';
}

function normalizePaymentStatus(payload = {}) {
  const raw = safeString(pick(payload, [
    'payment.status', 'payments.0.status', 'order.payment.status', 'paymentStatus', 'statusPagamento'
  ], 'paid'), 80);
  const key = normalizeKey(raw);
  if (['paid', 'pago', 'approved', 'aprovado', 'authorized', 'autorizado', 'settled', 'captured'].some((v) => key.includes(v))) return 'pago';
  if (['pending', 'pendente', 'waiting'].some((v) => key.includes(v))) return 'pendente';
  if (['cancel', 'cancelado', 'refused', 'failed', 'erro'].some((v) => key.includes(v))) return 'cancelado';
  return 'pago';
}

function normalizeExternalStatus(payload = {}) {
  return safeString(pick(payload, ['status', 'order.status', 'event.status', 'payload.status', 'code'], 'created'), 80);
}

async function gerarNumero99Food(restauranteId) {
  const prefixo = '99F';
  const [rows] = await queryWithRetry(
    `SELECT numeroPedido
       FROM pedidos
      WHERE restaurante = ? AND origem = '99food' AND numeroPedido LIKE '99F%'
      ORDER BY criadoEm DESC, created_at DESC, id DESC
      LIMIT 1`,
    [String(restauranteId)],
    { label: 'food99.numeroPedido' }
  );
  const ultimo = String(rows?.[0]?.numeroPedido || '').match(/99F(\d+)/)?.[1] || '0';
  return `${prefixo}${String(Number(ultimo) + 1).padStart(5, '0')}`;
}

async function findRestauranteBy99Food({ merchantId, token }) {
  const id = safeString(merchantId, 191);
  if (id) {
    const restaurante = await Restaurante.findOne({ food99MerchantId: id });
    if (restaurante) return restaurante;
  }

  // Fallback por token quando a plataforma não envia merchantId no payload de teste.
  if (token) {
    const candidatos = await Restaurante.find({ food99Status: true }).lean();
    return candidatos.find((r) => r?.food99WebhookToken && timingSafeEqual(r.food99WebhookToken, token)) || null;
  }

  return null;
}

function buildNormalizedOrder(payload = {}, restaurante = {}) {
  const food99Config = parseJsonSafe(restaurante.food99, {});
  const moneyOpts = { valoresEmCentavos: food99Config.valoresEmCentavos ?? process.env.FOOD99_VALUES_IN_CENTS };

  const orderId = safeString(pick(payload, [
    'id', 'orderId', 'order.id', 'pedido.id', 'displayId', 'reference', 'payload.orderId', 'event.orderId'
  ], ''), 191);

  const merchantId = safeString(pick(payload, [
    'merchantId', 'merchant.id', 'merchant.externalCode', 'storeId', 'store.id', 'restaurantId', 'payload.merchantId', 'order.merchantId'
  ], restaurante.food99MerchantId || ''), 191);

  const itens = normalizeItems(payload, moneyOpts);
  const itensTotal = round2(itens.reduce((acc, item) => acc + toNum(item.precoTotal || item.total), 0));
  const taxaEntrega = extractMoney(payload, [
    'delivery.deliveryFee', 'delivery.fee', 'deliveryFee', 'fees.delivery', 'total.deliveryFee', 'charges.deliveryFee'
  ], moneyOpts);
  let total = extractMoney(payload, [
    'total.orderAmount', 'total.orderAmount.value', 'total.value', 'total', 'orderTotal', 'amount',
    'payment.amount', 'payments.0.amount', 'prices.total', 'totalPrice'
  ], moneyOpts);
  if (total <= 0) total = round2(itensTotal + taxaEntrega);

  const taxaMarketplace = extractMoney(payload, [
    'fees.marketplace', 'marketplaceFee', 'commission.value', 'commission', 'financial.commission'
  ], moneyOpts);
  const valorRepasse = extractMoney(payload, [
    'financial.netValue', 'netValue', 'settlement.value', 'repasse', 'valorRepasse'
  ], moneyOpts);

  const customer = pick(payload, ['customer', 'cliente', 'order.customer'], {}) || {};
  const nomeCliente = safeString(pick(customer, ['name', 'nome', 'fullName'], pick(payload, ['customerName', 'nomeCliente'], 'Cliente 99Food')), 120);
  const telefoneCliente = onlyDigits(pick(customer, ['phone.number', 'phone', 'telefone', 'phoneNumber'], pick(payload, ['customerPhone', 'telefoneCliente'], '')));

  const pagamentoStatus = normalizePaymentStatus(payload);
  const status = pagamentoStatus === 'cancelado' ? 'cancelado' : 'pago';
  const agora = new Date();

  return {
    orderId,
    merchantId,
    numeroPedidoExterno: safeString(pick(payload, ['displayId', 'shortCode', 'order.displayId', 'code'], ''), 80),
    pedido: {
      restaurante: String(restaurante._id || restaurante.id),
      numeroPedido: '',
      origem: '99food',
      canalVenda: 'marketplace',
      marketplace: '99food',
      externalOrderId: orderId,
      externalMerchantId: merchantId,
      externalStatus: normalizeExternalStatus(payload),
      externalPayload: payload,
      nomeCliente,
      telefoneCliente,
      enderecoCliente: normalizeAddress(payload),
      itens,
      total,
      valorTotal: total,
      totalBruto: total,
      taxaEntrega,
      taxaMarketplace,
      valorRepasse,
      formaPagamento: normalizePaymentMethod(payload),
      formadePagamento: normalizePaymentMethod(payload),
      status,
      statusPagamento: pagamentoStatus === 'cancelado' ? 'cancelado' : pagamentoStatus,
      valorPago: pagamentoStatus === 'pago' ? total : 0,
      valorPendente: pagamentoStatus === 'pago' ? 0 : total,
      pagoEm: pagamentoStatus === 'pago' ? agora : null,
      criadoEm: new Date(pick(payload, ['createdAt', 'created_at', 'createdDate', 'order.createdAt'], Date.now())),
      statusAtualizadoEm: agora,
      pagamentos: pagamentoStatus === 'pago'
        ? [{ metodo: normalizePaymentMethod(payload), valor: total, status: 'confirmado', recebidoEm: agora, confirmadoEm: agora, recebidoPorRole: '99food' }]
        : [],
      observacao: safeString(pick(payload, ['observations', 'observation', 'notes', 'note', 'order.notes'], ''), 800),
    },
  };
}

async function criarOuAtualizarPedido99Food(payload, req = null, options = {}) {
  const token = extractHeaderToken(req || { headers: {}, query: {} });
  const merchantId = safeString(pick(payload, [
    'merchantId', 'merchant.id', 'merchant.externalCode', 'storeId', 'store.id', 'restaurantId', 'payload.merchantId', 'order.merchantId'
  ], options.restaurante?.food99MerchantId || ''), 191);

  const restaurante = options.restaurante || await findRestauranteBy99Food({ merchantId, token });
  if (!restaurante) {
    const err = new Error('Restaurante 99Food não encontrado para este merchantId/token.');
    err.status = 404;
    throw err;
  }

  if (!isTrue(restaurante.food99Status)) {
    const err = new Error('Integração 99Food está desativada neste restaurante.');
    err.status = 403;
    throw err;
  }

  const expectedToken = safeString(restaurante.food99WebhookToken || '', 500);
  const requireToken = normalizeKey(process.env.FOOD99_REQUIRE_WEBHOOK_TOKEN || '') === 'true';
  if (!options.skipTokenValidation && expectedToken && !timingSafeEqual(expectedToken, token)) {
    const err = new Error('Token do webhook 99Food inválido.');
    err.status = 401;
    throw err;
  }
  if (!options.skipTokenValidation && !expectedToken && requireToken) {
    const err = new Error('Configure o token do webhook 99Food no restaurante.');
    err.status = 401;
    throw err;
  }

  const normalized = buildNormalizedOrder(payload, restaurante);
  if (!normalized.orderId) {
    const err = new Error('Payload 99Food sem identificador do pedido.');
    err.status = 400;
    throw err;
  }

  const restauranteId = String(restaurante._id || restaurante.id);
  let pedido = await Pedido.findOne({ restaurante: restauranteId, origem: '99food', externalOrderId: normalized.orderId });

  if (pedido) {
    const prevStatus = pedido.status;
    Object.assign(pedido, {
      externalStatus: normalized.pedido.externalStatus,
      externalPayload: normalized.pedido.externalPayload,
      statusAtualizadoEm: new Date(),
    });
    if (normalized.pedido.status === 'cancelado') {
      pedido.status = 'cancelado';
      pedido.statusPagamento = 'cancelado';
      pedido.canceladoEm = new Date();
      pedido.motivoCancelamento = pedido.motivoCancelamento || 'Cancelado na 99Food';
    }
    await pedido.save();
    req?.io?.to(`restaurante-${restauranteId}`).emit('pedidoAtualizado', pedido);
    return { pedido, created: false, previousStatus: prevStatus };
  }

  normalized.pedido.numeroPedido = normalized.numeroPedidoExterno || await gerarNumero99Food(restauranteId);
  pedido = new Pedido(normalized.pedido);

  const caixa = await getCaixaAberto(restauranteId).catch(() => null);
  if (caixa) await vincularPedidoAoCaixa(pedido, caixa);
  await pedido.save();

  if (caixa && pedido.statusPagamento === 'pago') {
    await registrarMovimentoVenda({
      pedido,
      pagamento: { metodo: pedido.formaPagamento || '99food_online', valor: pedido.total, status: 'confirmado', paymentId: pedido.externalOrderId },
      caixa,
      restauranteId,
    }).catch((e) => console.warn('Falha ao registrar venda 99Food no caixa:', e?.message || e));
    await recalcularCaixa(caixa._id || caixa.id).catch(() => null);
  }

  req?.io?.to(`restaurante-${restauranteId}`).emit('novoPedido', pedido);
  req?.io?.to(`restaurante-${restauranteId}`).emit('caixaAtualizado', { origem: '99food' });
  return { pedido, created: true };
}

exports.webhook = async (req, res) => {
  try {
    const result = await criarOuAtualizarPedido99Food(req.body || {}, req);
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      pedidoId: result.pedido?._id || result.pedido?.id,
      numeroPedido: result.pedido?.numeroPedido,
      origem: '99food',
    });
  } catch (error) {
    console.error('[99Food webhook]', error?.message || error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || 'Erro ao processar pedido 99Food.' });
  }
};

exports.status = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || '');
    const restaurante = await Restaurante.findById(restauranteId).select('food99Status food99MerchantId food99WebhookToken food99ClientId food99BaseUrl food99');
    if (!restaurante) return res.status(404).json({ message: 'Restaurante não encontrado.' });
    return res.json({
      food99Status: !!restaurante.food99Status,
      food99MerchantId: restaurante.food99MerchantId || '',
      webhookConfigurado: !!restaurante.food99WebhookToken,
      clientIdConfigurado: !!restaurante.food99ClientId,
      food99BaseUrl: restaurante.food99BaseUrl || '',
      food99: restaurante.food99 || {},
      webhookUrl: `${String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL || '').replace(/\/$/, '')}/api/99food/webhook`,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Erro ao consultar status 99Food.', error: error.message });
  }
};

exports.criarPedidoTeste = async (req, res) => {
  try {
    const restauranteId = String(req.restauranteId || req.userId || '');
    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: 'Restaurante não encontrado.' });

    if (!restaurante.food99MerchantId) {
      restaurante.food99MerchantId = `teste-${restauranteId}`;
    }
    restaurante.food99Status = true;
    await restaurante.save();

    const payload = {
      id: `TESTE-99-${Date.now()}`,
      merchantId: restaurante.food99MerchantId,
      displayId: `99T${String(Date.now()).slice(-5)}`,
      status: 'created',
      customer: { name: 'Cliente Teste 99Food', phone: '81999999999' },
      delivery: { address: { street: 'Rua Teste 99Food', number: '100', neighborhood: 'Centro', city: 'Olinda', state: 'PE' }, deliveryFee: 5 },
      items: [
        { id: 'teste-1', name: 'Pedido teste 99Food', quantity: 1, unitPrice: 25, totalPrice: 25 },
      ],
      payment: { method: 'ONLINE', status: 'PAID', amount: 30 },
      total: 30,
      createdAt: new Date().toISOString(),
    };

    const result = await criarOuAtualizarPedido99Food(payload, req, { restaurante, skipTokenValidation: true });
    return res.status(201).json({ ok: true, pedido: result.pedido, created: result.created });
  } catch (error) {
    console.error('[99Food teste]', error?.message || error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || 'Erro ao criar pedido teste 99Food.' });
  }
};

exports._private = { criarOuAtualizarPedido99Food, buildNormalizedOrder };
