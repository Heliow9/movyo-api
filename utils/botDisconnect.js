function normalizeDisconnectCode(code) {
  const parsed = Number(code);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDisconnectMessage(message) {
  return String(message || "").trim().toLowerCase();
}

function isInvalidSessionDisconnect(code, message, reasons = {}) {
  const parsedCode = normalizeDisconnectCode(code);
  const loggedOut = Number(reasons.loggedOut ?? 401);
  const badSession = Number(reasons.badSession ?? 500);

  if (parsedCode === loggedOut) return true;
  if (parsedCode !== badSession) return false;

  // O Baileys usa 500 como fallback para stream errors sem código. Portanto,
  // só apaga as credenciais quando a mensagem também comprova sessão inválida.
  const normalizedMessage = normalizeDisconnectMessage(message);
  return [
    "bad session",
    "invalid session",
    "session invalid",
    "logged out",
    "not authorized",
    "not-authorized",
    "device removed",
    "device_removed",
  ].some((marker) => normalizedMessage.includes(marker));
}

function isRestartableDisconnect(code, message, reasons = {}) {
  const parsedCode = normalizeDisconnectCode(code);
  const normalizedMessage = normalizeDisconnectMessage(message);
  const badSession = Number(reasons.badSession ?? 500);

  if (isInvalidSessionDisconnect(parsedCode, normalizedMessage, reasons)) return false;

  return (
    parsedCode === badSession ||
    parsedCode === 515 ||
    parsedCode === 408 ||
    parsedCode === Number(reasons.restartRequired ?? 515) ||
    parsedCode === Number(reasons.timedOut ?? 408) ||
    normalizedMessage.includes("stream errored") ||
    normalizedMessage.includes("internal server error") ||
    normalizedMessage.includes("connection failure") ||
    normalizedMessage.includes("restart required") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("request time-out")
  );
}

module.exports = {
  isInvalidSessionDisconnect,
  isRestartableDisconnect,
};
