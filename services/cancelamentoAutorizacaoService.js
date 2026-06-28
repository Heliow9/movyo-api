const OperadorCaixa = require("../models/OperadorCaixa");
const { getCaixaAberto } = require("./caixaService");

function bool(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function roleFromReq(req) {
  return String(req?.role || req?.user?.role || "").trim().toLowerCase();
}

function permissoesFromReq(req) {
  return req?.user?.permissoes || req?.permissoes || {};
}

function createAuthorizationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function autorizarCancelamento(req, restauranteId) {
  if (roleFromReq(req) !== "garcom") {
    return { autorizado: true, modo: "restaurante" };
  }

  const permissoes = permissoesFromReq(req);
  if (!bool(permissoes.cancelarPedido)) {
    throw createAuthorizationError(
      403,
      "PERMISSION_DENIED",
      "Seu perfil nao possui permissao para cancelar pedidos."
    );
  }

  if (bool(permissoes.cancelarSemPinGerente)) {
    return { autorizado: true, modo: "permissao_direta" };
  }

  const caixa = await getCaixaAberto(restauranteId).catch(() => null);
  if (!caixa) {
    throw createAuthorizationError(
      409,
      "CAIXA_NAO_ABERTO_PARA_AUTORIZACAO",
      "Nao ha caixa aberto para validar o PIN do operador responsavel."
    );
  }

  const operador = await OperadorCaixa.findById(caixa.operadorId);
  if (!operador || String(operador.restauranteId) !== String(restauranteId)) {
    throw createAuthorizationError(
      409,
      "OPERADOR_CAIXA_NAO_ENCONTRADO",
      "O operador responsavel pelo caixa nao foi encontrado."
    );
  }

  const pinConfigurado = String(operador.pin || "").trim();
  if (!pinConfigurado) {
    throw createAuthorizationError(
      409,
      "OPERADOR_SEM_PIN",
      "O operador que abriu o caixa precisa cadastrar um PIN para autorizar cancelamentos."
    );
  }

  const pinInformado = String(req?.body?.pinGerente || req?.body?.pinOperador || "").trim();
  if (!pinInformado) {
    throw createAuthorizationError(
      428,
      "PIN_GERENTE_NECESSARIO",
      "Informe o PIN do operador que abriu o caixa para autorizar o cancelamento."
    );
  }
  if (pinInformado !== pinConfigurado) {
    throw createAuthorizationError(
      401,
      "PIN_GERENTE_INVALIDO",
      "PIN do operador responsavel pelo caixa invalido."
    );
  }

  return {
    autorizado: true,
    modo: "pin_operador_caixa",
    caixaId: String(caixa._id || caixa.id || ""),
    operadorId: String(operador._id || operador.id || ""),
    operadorNome: operador.nome || "",
  };
}

module.exports = {
  autorizarCancelamento,
  roleFromReq,
  permissoesFromReq,
};
