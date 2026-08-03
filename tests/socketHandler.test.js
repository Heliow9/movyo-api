const test = require('node:test');
const assert = require('node:assert/strict');

const setupSockets = require('../sockets/socketHandler');
const { pool } = require('../db/mysql');

test.after(async () => {
  await pool.end();
});

function createIo() {
  const handlers = new Map();
  const emitted = [];
  return {
    handlers,
    emitted,
    use(handler) { this.middleware = handler; },
    on(event, handler) { handlers.set(event, handler); },
    to(room) {
      const operator = {
        emit(event, payload) { emitted.push({ room, event, payload }); },
      };
      Object.defineProperty(operator, 'volatile', { get: () => operator });
      return operator;
    },
  };
}

function createSocket(data = {}) {
  const handlers = new Map();
  const joined = [];
  const emitted = [];
  return {
    id: 'socket-test',
    data,
    connected: true,
    rooms: new Set(['socket-test']),
    handlers,
    joined,
    emitted,
    on(event, handler) { handlers.set(event, handler); },
    join(room) { joined.push(room); this.rooms.add(room); },
    emit(event, payload) { emitted.push({ event, payload }); },
  };
}

test('socket autenticado so entra na sala do proprio restaurante', () => {
  const io = createIo();
  setupSockets(io);
  const socket = createSocket({
    auth: { id: 'rest-1' },
    role: 'restaurante',
    restauranteId: 'rest-1',
  });
  io.handlers.get('connection')(socket);

  let denied;
  socket.handlers.get('joinRestaurante')({ restauranteId: 'rest-2' }, (result) => { denied = result; });
  assert.equal(denied.ok, false);
  assert.deepEqual(socket.joined, []);

  let accepted;
  socket.handlers.get('joinRestaurante')({ restauranteId: 'rest-1' }, (result) => { accepted = result; });
  assert.equal(accepted.ok, true);
  assert.deepEqual(socket.joined, ['restaurante-rest-1']);
});

test('eventos GPS invalidos ou acima do limite sao rejeitados sem banco', async () => {
  const io = createIo();
  setupSockets(io);
  const socket = createSocket({
    auth: { role: 'entregador' },
    role: 'entregador',
    restauranteId: 'rest-1',
    entregadorId: 'driver-1',
    entregador: { _id: 'driver-1', restaurante: 'rest-1' },
  });
  io.handlers.get('connection')(socket);
  const handler = socket.handlers.get('localizacaoAtualizada');

  let invalid;
  await handler({ entregadorId: 'driver-1', latitude: 100, longitude: 20 }, (result) => { invalid = result; });
  assert.equal(invalid.ok, false);

  socket.data.locationRate = { windowStartedAt: Date.now(), count: 999 };
  let throttled;
  await handler({ entregadorId: 'driver-1', latitude: -23.5, longitude: -46.6 }, (result) => { throttled = result; });
  assert.deepEqual(throttled, { ok: true, throttled: true });
  assert.equal(io.emitted.length, 0);
});
