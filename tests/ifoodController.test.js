const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { _private } = require('../controllers/ifoodController');
const defs = require('../models/_defs');
const { pool } = require('../db/mysql');

test.after(async () => {
  await pool.end();
});

test('normaliza pedido iFood sem converter valores decimais inteiros em centavos', () => {
  const pedido = _private.buildPedidoFromIfood({
    id: 'order-123',
    displayId: '1234',
    orderType: 'DELIVERY',
    orderTiming: 'IMMEDIATE',
    merchant: { id: 'merchant-1' },
    customer: { name: 'Cliente Teste', phone: { number: '11999998888', localizer: '4321' } },
    items: [{ id: 'item-1', name: 'Combo', quantity: 1, unitPrice: 1500, totalPrice: 1500 }],
    total: { orderAmount: 1500 },
    delivery: {
      deliveredBy: 'IFOOD',
      pickupCode: '9876',
      observations: 'Tocar o interfone',
      deliveryAddress: {
        streetName: 'Rua Teste',
        streetNumber: '10',
        neighborhood: 'Centro',
        postalCode: '01001000',
        coordinates: { latitude: -23.55, longitude: -46.63 },
      },
    },
    payments: { prepaid: true, methods: [{ method: 'CREDIT', card: { brand: 'VISA' } }] },
    benefits: [{ value: 10 }],
  }, { id: 'event-1', code: 'PLC', merchantId: 'merchant-1' }, { _id: 'rest-1' });

  assert.equal(pedido.total, 1500);
  assert.equal(pedido.deliveryProvider, 'IFOOD');
  assert.equal(pedido.pickupCode, '9876');
  assert.equal(pedido.deliveryLocalizer, '4321');
  assert.equal(pedido.pagamento.brand, 'VISA');
  assert.equal(pedido.descontoValor, 10);
  assert.equal(pedido.latitudeCliente, -23.55);
  assert.equal(pedido.status, 'pendente');
});

test('estado inicial considera apenas cancelamento final, sem confundir negociacao', () => {
  assert.equal(_private.initialLocalStatus({ code: 'CANCELLATION_REQUESTED' }), 'pendente');
  assert.equal(_private.initialLocalStatus({ code: 'DELIVERY_CANCELLATION_REQUEST_ACCEPTED' }), 'pendente');
  assert.equal(_private.initialLocalStatus({ code: 'CAN' }), 'cancelado');
  assert.equal(_private.initialLocalStatus({ code: 'CFM' }), 'em_producao');
  assert.equal(_private.initialLocalStatus({ code: 'DSP' }), 'em_entrega');
  assert.equal(_private.initialLocalStatus({ code: 'CONCLUDED' }), 'entregue');
});

test('valida assinatura HMAC do webhook usando o corpo bruto', () => {
  const oldSecret = process.env.IFOOD_WEBHOOK_SECRET;
  const oldRequired = process.env.IFOOD_REQUIRE_WEBHOOK_SIGNATURE;
  process.env.IFOOD_WEBHOOK_SECRET = 'segredo-de-teste';
  process.env.IFOOD_REQUIRE_WEBHOOK_SIGNATURE = 'true';
  const rawBody = Buffer.from(JSON.stringify([{ id: 'event-1', code: 'PLC' }]));
  const signature = crypto.createHmac('sha256', process.env.IFOOD_WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    assert.equal(_private.verifyWebhookSignature({ rawBody, body: {}, headers: { 'x-ifood-signature': signature } }).ok, true);
    assert.equal(_private.verifyWebhookSignature({ rawBody, body: {}, headers: { 'x-ifood-signature': '00'.repeat(32) } }).ok, false);
  } finally {
    if (oldSecret === undefined) delete process.env.IFOOD_WEBHOOK_SECRET;
    else process.env.IFOOD_WEBHOOK_SECRET = oldSecret;
    if (oldRequired === undefined) delete process.env.IFOOD_REQUIRE_WEBHOOK_SIGNATURE;
    else process.env.IFOOD_REQUIRE_WEBHOOK_SIGNATURE = oldRequired;
  }
});

test('schema protege eventos e pedidos externos contra duplicidade', () => {
  assert.ok(defs.IfoodEvent.indexes.some((sql) => /UNIQUE INDEX uq_ifood_event_id/i.test(sql)));
  assert.ok(defs.Pedido.indexes.some((sql) => /UNIQUE INDEX uq_pedidos_external/i.test(sql)));
});
