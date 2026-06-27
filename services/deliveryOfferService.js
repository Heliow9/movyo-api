const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const Restaurante = require("../models/Restaurante");
const { sendExpoPushToken } = require("./webPushService");

const OFFER_TIMEOUT_SECONDS = Math.max(
  30,
  Number(process.env.DELIVERY_OFFER_TIMEOUT_SECONDS || 120)
);
const STATUS_ENTREGA_ATIVA = ["aguardando_resposta", "em_rota", "em_entrega"];
const offerTimers = new Map();
const offerLocks = new Map();

function idString(value) {
  return String(value?._id || value?.id || value || "");
}

async function withOfferLock(pedidoId, callback) {
  const key = idString(pedidoId);
  const previous = offerLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(callback);
  offerLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (offerLocks.get(key) === current) offerLocks.delete(key);
  }
}

async function obterLimitePedidosPorEntregador(restauranteId) {
  const restaurante = await Restaurante.findById(restauranteId).lean();
  const raw =
    restaurante?.maxPedidosPorEntregador ??
    restaurante?.pedidosPorEntregador ??
    3;
  const limite = Number(raw);
  return Number.isFinite(limite) ? Math.max(1, Math.round(limite)) : 3;
}

async function contarEntregasAtivas(entregadorId, pedidoIdIgnorar = null) {
  const filtro = {
    entregador: entregadorId,
    status: { $in: STATUS_ENTREGA_ATIVA },
  };
  if (pedidoIdIgnorar) filtro._id = { $ne: pedidoIdIgnorar };
  return Pedido.countDocuments(filtro);
}

function segundosDecorridos(oferta, agora = new Date()) {
  const inicio = oferta?.enviadaEm ? new Date(oferta.enviadaEm) : agora;
  return Math.max(0, Math.round((agora - inicio) / 1000));
}

function clearOfferTimer(pedidoId) {
  const key = idString(pedidoId);
  if (offerTimers.has(key)) clearTimeout(offerTimers.get(key));
  offerTimers.delete(key);
}

function emitOfferResult(io, pedido, eventName, extra = {}) {
  const restauranteId = idString(pedido.restaurante);
  const entregadorId = idString(
    extra.entregadorId || pedido.entregador || pedido.ofertaEntrega?.entregadorId
  );
  const payload = {
    pedido,
    pedidoId: idString(pedido),
    entregadorId,
    ofertaEntrega: pedido.ofertaEntrega || null,
    ...extra,
  };

  if (restauranteId) {
    io?.to(`restaurante-${restauranteId}`).emit(eventName, payload);
    io?.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
  }
  if (entregadorId) {
    io?.to(`entregador-${entregadorId}`).emit(eventName, payload);
  }
}

async function expirarOferta(pedidoId, io, reason = "tempo_limite") {
  return withOfferLock(pedidoId, async () => {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido || pedido.status !== "aguardando_resposta") return null;

    const oferta = pedido.ofertaEntrega || {};
    if (oferta.status && oferta.status !== "aguardando") return null;

    const agora = new Date();
    const entregadorId = idString(oferta.entregadorId || pedido.entregador);
    pedido.ofertaEntrega = {
      ...oferta,
      status: "expirada",
      motivo: reason,
      respondidaEm: agora,
      segundosResposta: segundosDecorridos(oferta, agora),
    };
    pedido.status = oferta.statusAnterior || "em_entrega";
    pedido.statusAtualizadoEm = agora;
    pedido.entregador = null;
    await pedido.save();
    clearOfferTimer(pedidoId);

    const extra = {
      entregadorId,
      motivo: reason,
      segundosResposta: pedido.ofertaEntrega.segundosResposta,
    };
    emitOfferResult(io, pedido, "pedidoOfertaExpirada", extra);
    emitOfferResult(io, pedido, "pedidoNaoAceito", extra);
    return pedido;
  });
}

function scheduleOfferExpiration(pedidoId, expiraEm, io) {
  clearOfferTimer(pedidoId);
  const delay = Math.max(0, new Date(expiraEm).getTime() - Date.now());
  const timer = setTimeout(() => {
    expirarOferta(pedidoId, io).catch((error) =>
      console.error("Erro ao expirar oferta de entrega:", error?.message || error)
    );
  }, delay);
  timer.unref?.();
  offerTimers.set(idString(pedidoId), timer);
}

async function enviarOferta({
  pedidoId,
  entregadorId,
  restauranteId,
  io,
  origem = "desktop",
}) {
  return withOfferLock(pedidoId, async () => {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) {
      const error = new Error("Pedido nao encontrado.");
      error.status = 404;
      throw error;
    }

    const restId = idString(pedido.restaurante);
    if (restauranteId && restId !== idString(restauranteId)) {
      const error = new Error("Pedido pertence a outro restaurante.");
      error.status = 403;
      throw error;
    }

    if (["entregue", "cancelado"].includes(String(pedido.status || "").toLowerCase())) {
      const error = new Error(`Pedido com status '${pedido.status}' nao pode ser enviado.`);
      error.status = 409;
      throw error;
    }

    const entregador = await Entregador.findById(entregadorId);
    if (!entregador || idString(entregador.restaurante) !== restId) {
      const error = new Error("Entregador invalido para este restaurante.");
      error.status = 403;
      throw error;
    }
    if (
      entregador.status === false ||
      entregador.disponivel === false ||
      String(entregador.statusConta || "ativo").toLowerCase() === "bloqueado"
    ) {
      const error = new Error("Entregador esta offline, indisponivel ou bloqueado.");
      error.status = 409;
      throw error;
    }

    const limite = await obterLimitePedidosPorEntregador(restId);
    const ativas = await contarEntregasAtivas(entregadorId, pedidoId);
    if (ativas >= limite) {
      const error = new Error(
        `Este entregador ja atingiu o limite de ${limite} entrega(s) ativa(s).`
      );
      error.status = 409;
      error.details = { limite, entregasAtivas: ativas };
      throw error;
    }

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + OFFER_TIMEOUT_SECONDS * 1000);
    const tentativas = Number(pedido.ofertaEntrega?.tentativas || 0) + 1;
    const statusAnterior =
      pedido.status === "aguardando_resposta"
        ? pedido.ofertaEntrega?.statusAnterior || "em_entrega"
        : pedido.status || "em_entrega";

    pedido.entregador = entregadorId;
    pedido.status = "aguardando_resposta";
    pedido.statusAtualizadoEm = agora;
    pedido.ofertaEntrega = {
      status: "aguardando",
      entregadorId: idString(entregadorId),
      entregadorNome: entregador.nome || "",
      enviadaEm: agora,
      expiraEm,
      timeoutSegundos: OFFER_TIMEOUT_SECONDS,
      tentativas,
      origem,
      statusAnterior,
    };
    await pedido.save();

    io?.to(`entregador-${entregadorId}`).emit("pedidoRecebido", pedido);
    io?.to(`restaurante-${restId}`).emit("pedidoEnviado", {
      pedido,
      ofertaEntrega: pedido.ofertaEntrega,
    });
    io?.to(`restaurante-${restId}`).emit("pedidoAtualizado", pedido);
    scheduleOfferExpiration(pedidoId, expiraEm, io);

    if (entregador.expoPushToken) {
      sendExpoPushToken(entregador.expoPushToken, {
        title: "Nova entrega Movyo",
        body: `Pedido #${pedido.numeroPedido || idString(pedido).slice(-6)} para ${
          pedido.nomeCliente || "cliente"
        }. Responda em ${OFFER_TIMEOUT_SECONDS} segundos.`,
        sound: "novo_pedido.mp3",
        channelId: "movyo-entregas",
        categoryId: "pedido-actions",
        ttl: OFFER_TIMEOUT_SECONDS,
        data: {
          type: "delivery_offer",
          pedidoId: idString(pedido),
          entregadorId: idString(entregadorId),
          expiraEm: expiraEm.toISOString(),
        },
      }).catch((error) =>
        console.warn("Push de oferta ao motorista falhou:", error?.message || error)
      );
    }

    return { pedido, entregador, limite, entregasAtivas: ativas + 1 };
  });
}

async function aceitarOferta({ pedidoId, entregadorId, io }) {
  return withOfferLock(pedidoId, async () => {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) {
      const error = new Error("Pedido nao encontrado.");
      error.status = 404;
      throw error;
    }
    const oferta = pedido.ofertaEntrega || {};
    if (
      pedido.status !== "aguardando_resposta" ||
      oferta.status !== "aguardando" ||
      idString(oferta.entregadorId || pedido.entregador) !== idString(entregadorId)
    ) {
      const error = new Error("Esta oferta nao esta mais disponivel.");
      error.status = 409;
      throw error;
    }
    if (oferta.expiraEm && new Date(oferta.expiraEm).getTime() <= Date.now()) {
      const error = new Error("O tempo para aceitar esta entrega terminou.");
      error.status = 409;
      throw error;
    }

    const agora = new Date();
    pedido.entregador = entregadorId;
    pedido.status = "em_rota";
    pedido.aceitoEm = agora;
    pedido.statusAtualizadoEm = agora;
    pedido.ofertaEntrega = {
      ...oferta,
      status: "aceita",
      respondidaEm: agora,
      segundosResposta: segundosDecorridos(oferta, agora),
    };
    await pedido.save();
    clearOfferTimer(pedidoId);
    emitOfferResult(io, pedido, "pedidoAceito", {
      entregadorId,
      segundosResposta: pedido.ofertaEntrega.segundosResposta,
    });
    return pedido;
  });
}

async function recusarOferta({
  pedidoId,
  entregadorId,
  motivo = "recusado_pelo_motorista",
  io,
}) {
  return withOfferLock(pedidoId, async () => {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) {
      const error = new Error("Pedido nao encontrado.");
      error.status = 404;
      throw error;
    }
    const oferta = pedido.ofertaEntrega || {};
    if (
      pedido.status !== "aguardando_resposta" ||
      oferta.status !== "aguardando" ||
      idString(oferta.entregadorId || pedido.entregador) !== idString(entregadorId)
    ) {
      const error = new Error("Esta oferta nao esta mais disponivel.");
      error.status = 409;
      throw error;
    }

    const agora = new Date();
    const motoristaId = idString(entregadorId);
    pedido.ofertaEntrega = {
      ...oferta,
      status: "recusada",
      motivo: String(motivo || "recusado_pelo_motorista").slice(0, 255),
      respondidaEm: agora,
      segundosResposta: segundosDecorridos(oferta, agora),
    };
    pedido.status = oferta.statusAnterior || "em_entrega";
    pedido.statusAtualizadoEm = agora;
    pedido.entregador = null;
    await pedido.save();
    clearOfferTimer(pedidoId);
    emitOfferResult(io, pedido, "pedidoRecusado", {
      entregadorId: motoristaId,
      motivo: pedido.ofertaEntrega.motivo,
      segundosResposta: pedido.ofertaEntrega.segundosResposta,
    });
    return pedido;
  });
}

async function recuperarOfertasPendentes(io) {
  const pendentes = await Pedido.find({ status: "aguardando_resposta" }).lean();
  for (const pedido of pendentes) {
    const expiraEm = pedido.ofertaEntrega?.expiraEm;
    if (!expiraEm || new Date(expiraEm).getTime() <= Date.now()) {
      await expirarOferta(pedido._id, io, "api_reiniciada_ou_tempo_limite");
    } else {
      scheduleOfferExpiration(pedido._id, expiraEm, io);
    }
  }
  return { recuperadas: pendentes.length };
}

module.exports = {
  OFFER_TIMEOUT_SECONDS,
  enviarOferta,
  aceitarOferta,
  recusarOferta,
  expirarOferta,
  recuperarOfertasPendentes,
  contarEntregasAtivas,
  obterLimitePedidosPorEntregador,
};
