const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isInvalidSessionDisconnect,
  isRestartableDisconnect,
} = require("../utils/botDisconnect");

const reasons = {
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  timedOut: 408,
};

test("500 genérico durante o pareamento preserva a sessão e reinicia o socket", () => {
  const message = "An internal server error occurred";
  assert.equal(isInvalidSessionDisconnect(500, message, reasons), false);
  assert.equal(isRestartableDisconnect(500, message, reasons), true);
});

test("stream error 500 sem motivo conhecido é reiniciável", () => {
  const message = "Stream Errored (unknown)";
  assert.equal(isInvalidSessionDisconnect(500, message, reasons), false);
  assert.equal(isRestartableDisconnect(500, message, reasons), true);
});

test("logout e sessão explicitamente inválida continuam removendo credenciais", () => {
  assert.equal(isInvalidSessionDisconnect(401, "Logged Out", reasons), true);
  assert.equal(isInvalidSessionDisconnect(500, "Bad Session", reasons), true);
  assert.equal(isInvalidSessionDisconnect(500, "Invalid account signature", reasons), true);
  assert.equal(isInvalidSessionDisconnect(500, "Failed to verify account signature", reasons), true);
  assert.equal(isRestartableDisconnect(500, "Bad Session", reasons), false);
  assert.equal(isRestartableDisconnect(500, "Invalid account signature", reasons), false);
});

test("restart required e timeout são reiniciáveis", () => {
  assert.equal(isRestartableDisconnect(515, "restart required", reasons), true);
  assert.equal(isRestartableDisconnect(408, "timed out", reasons), true);
});
