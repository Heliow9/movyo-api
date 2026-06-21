let entregadoresOnline = [];
const timeoutsDePedidos = new Map();

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const Restaurante = require("../models/Restaurante");
const axios = require("axios");

const STATUS_ENTREGA_ATIVA = ["aguardando_resposta", "em_rota", "em_entrega"];

const ENTREGA_ACEITE_TIMEOUT_MS = Number(process.env.ENTREGA_ACEITE_TIMEOUT_MS || 180 * 1000);

function criarSolicitacaoEntregaId() {
  return require("crypto").randomBytes(8).toString("hex");
}

function limparTimeoutPedido(pedidoId) {
  const key = idString(pedidoId);
  const timer = timeoutsDePedidos.get(key);
  if (timer) clearTimeout(timer);
  timeoutsDePedidos.delete(key);
}

function idString(value) {
  return String(value?._id || value?.id || value || "");
}

async function obterLimitePedidosPorEntregador(restauranteId) {
  const restaurante = await Restaurante.findById(restauranteId).lean();
  const raw = restaurante?.maxPedidosPorEntregador ?? restaurante?.pedidosPorEntregador ?? 3;
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


function pedidoPlain(pedido) {
  return pedido && typeof pedido.toObject === "function" ? pedido.toObject() : { ...(pedido || {}) };
}

function entregadorPublico(entregador = {}) {
  if (!entregador) return null;
  return {
    _id: idString(entregador._id || entregador.id),
    id: idString(entregador._id || entregador.id),
    nome: entregador.nome,
    email: entregador.email,
    localizacao: entregador.localizacao || null,
  };
}

function adicionarHistoricoEntrega(pedido, evento = {}) {
  const lista = Array.isArray(pedido.historicoEntregadores) ? pedido.historicoEntregadores : [];
  pedido.historicoEntregadores = [...lista.slice(-20), { ...evento, em: evento.em || new Date().toISOString() }];
}

function montarPayloadPedido(pedido, entregador = null, extra = {}) {
  const plain = pedidoPlain(pedido);
  return {
    ...plain,
    _id: idString(plain._id || plain.id),
    id: idString(plain._id || plain.id),
    entregador: entregador ? entregadorPublico(entregador) : (plain.entregador || null),
    tempoAceiteSegundos: Math.ceil(ENTREGA_ACEITE_TIMEOUT_MS / 1000),
    ...extra,
  };
}

async function liberarPedidoParaNovoDirecionamento(io, { pedido, entregadorId, restauranteId, motivo, tipo = "recusado" }) {
  if (!pedido) return null;
  const agora = new Date();
  const entregadorAnterior = idString(entregadorId || pedido.entregador);
  const solicitacaoId = pedido.entregadorSolicitacaoId || pedido.entregadorSolicitacao?.id || "";
  pedido.status = "em_entrega";
  pedido.entregador = null;
  pedido.statusEntrega = tipo === "timeout" ? "nao_aceito" : "recusado_entregador";
  pedido.entregadorRecusadoEm = agora;
  pedido.entregadorRecusaMotivo = motivo || (tipo === "timeout" ? "Tempo de aceite esgotado." : "Pedido recusado pelo entregador.");
  pedido.entregadorSolicitacaoId = null;
  pedido.entregadorSolicitacao = null;
  pedido.entregadorAceiteExpiraEm = null;
  pedido.statusAtualizadoEm = agora;
  if (!pedido.emEntregaEm) pedido.emEntregaEm = agora;
  adicionarHistoricoEntrega(pedido, { tipo, entregadorId: entregadorAnterior, solicitacaoId, motivo: pedido.entregadorRecusaMotivo });
  await pedido.save();
  limparTimeoutPedido(pedido._id || pedido.id);
  const payload = montarPayloadPedido(pedido, null, { entregadorAnterior, tipo, motivo: pedido.entregadorRecusaMotivo });
  const roomRestaurante = restauranteId || idString(pedido.restaurante);
  if (roomRestaurante) {
    io.to(`restaurante-${roomRestaurante}`).emit("pedidoRecusado", payload);
    io.to(`restaurante-${roomRestaurante}`).emit("pedidoNaoAceito", payload);
    io.to(`restaurante-${roomRestaurante}`).emit("pedidoAtualizado", payload);
  }
  if (entregadorAnterior) {
    io.to(`entregador-${entregadorAnterior}`).emit("pedidoSolicitacaoEncerrada", payload);
    io.to(`entregador-${entregadorAnterior}`).emit("pedidoSolicitacaoExpirada", payload);
  }
  return payload;
}

async function expirarSolicitacaoEntregaSocket(io, { pedidoId, entregadorId, solicitacaoId, restauranteId }) {
  try {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return;
    const mesmoEntregador = idString(pedido.entregador) === idString(entregadorId);
    const mesmaSolicitacao = !solicitacaoId || idString(pedido.entregadorSolicitacaoId) === idString(solicitacaoId);
    if (pedido.status === "aguardando_resposta" && mesmoEntregador && mesmaSolicitacao) {
      await liberarPedidoParaNovoDirecionamento(io, {
        pedido,
        entregadorId,
        restauranteId,
        tipo: "timeout",
        motivo: "Motorista não aceitou em até 180 segundos.",
      });
    }
  } catch (err) {
    console.log("🔥 timeout pedido entregador erro:", err?.message);
  }
}

function normalizarLocalizacaoPayload(payload = {}) {
  const latitude = Number(payload.latitude ?? payload.localizacao?.latitude ?? payload.coords?.latitude);
  const longitude = Number(payload.longitude ?? payload.localizacao?.longitude ?? payload.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function emitirEntregadoresOnline(io, restauranteId) {
  if (!restauranteId) return;
  const lista = entregadoresOnline.filter((e) => e.restauranteId === String(restauranteId));
  // Mantem os dois nomes porque o Desktop usa deliverersOnline e o app motorista
  // tambem ja teve versoes ouvindo entregadoresOnline.
  io.to(`restaurante-${restauranteId}`).emit("deliverersOnline", lista);
  io.to(`restaurante-${restauranteId}`).emit("entregadoresOnline", lista);
}

async function atualizarLocalizacaoEntregadorSocket(io, payload = {}) {
  try {
    const entregadorId = payload.entregadorId || payload.id || payload._id;
    const locBase = normalizarLocalizacaoPayload(payload);
    if (!entregadorId || !locBase) return;

    const entregador = await Entregador.findById(entregadorId);
    if (!entregador) return;

    const agoraIso = new Date().toISOString();
    const loc = { ...locBase, atualizadoEm: agoraIso };
    const statusPayload = payload.online ?? payload.status;
    const estaDisponivel = statusPayload === undefined ? true : Boolean(statusPayload);

    entregador.localizacao = loc;
    if (statusPayload !== undefined) {
      entregador.status = estaDisponivel;
      entregador.disponivel = estaDisponivel;
    }
    await entregador.save();

    const restauranteId = String(payload.restauranteId || entregador.restaurante || entregador.restauranteId || "");
    const updatePayload = {
      id: String(entregador._id || entregador.id),
      _id: String(entregador._id || entregador.id),
      entregadorId: String(entregador._id || entregador.id),
      socketId: payload.socketId,
      nome: entregador.nome,
      email: entregador.email,
      restauranteId,
      latitude: loc.latitude,
      longitude: loc.longitude,
      localizacao: loc,
      status: estaDisponivel,
      disponivel: estaDisponivel,
      atualizadoEm: agoraIso,
    };

    if (!estaDisponivel) {
      entregadoresOnline = entregadoresOnline.filter((e) => String(e.id || e._id || e.entregadorId) !== String(entregadorId));
      io.to(`entregador-${entregadorId}`).emit("atualizacaoLocalizacao", loc);
      if (restauranteId) {
        io.to(`restaurante-${restauranteId}`).emit("localizacaoAtualizada", updatePayload);
        io.to(`restaurante-${restauranteId}`).emit("delivererLocationUpdated", updatePayload);
        io.to(`restaurante-${restauranteId}`).emit("delivererStatusUpdated", updatePayload);
        emitirEntregadoresOnline(io, restauranteId);
      }
      return;
    }

    let found = false;
    entregadoresOnline = entregadoresOnline.map((e) => {
      if (String(e.id || e._id || e.entregadorId) !== String(entregadorId)) return e;
      found = true;
      return { ...e, ...updatePayload, socketId: e.socketId || payload.socketId };
    });

    if (!found && restauranteId) {
      const pedidosAtivos = await Pedido.countDocuments({
        entregador: entregadorId,
        status: { $in: STATUS_ENTREGA_ATIVA },
      });
      entregadoresOnline.push({ ...updatePayload, pedidosAtivos });
    }

    io.to(`entregador-${entregadorId}`).emit("atualizacaoLocalizacao", loc);
    if (restauranteId) {
      io.to(`restaurante-${restauranteId}`).emit("localizacaoAtualizada", updatePayload);
      io.to(`restaurante-${restauranteId}`).emit("delivererLocationUpdated", updatePayload);
      io.to(`restaurante-${restauranteId}`).emit("delivererStatusUpdated", updatePayload);
      emitirEntregadoresOnline(io, restauranteId);
    }
  } catch (err) {
    console.log("🔥 atualizarLocalizacaoEntregadorSocket erro:", err?.message);
  }
}

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🔌 Socket conectado:", socket.id);

    const safeJoin = (room) => {
      if (!room) return;
      socket.join(room);
      console.log(`✅ join: ${socket.id} -> ${room}`);
      // ajuda debug: mostra as rooms atuais
      // (sempre tem a room do próprio socket.id)
      console.log("rooms:", Array.from(socket.rooms));
    };

    /* =========================================================
     * 🏪 RESTAURANTE
     * =======================================================*/
    socket.on("joinRestaurante", ({ restauranteId } = {}) => {
      if (!restauranteId) {
        console.log("⚠️ joinRestaurante sem restauranteId");
        return;
      }

      const room = `restaurante-${restauranteId}`;
      safeJoin(room);

      socket.emit(
        "deliverersOnline",
        entregadoresOnline.filter((e) => e.restauranteId === String(restauranteId))
      );
    });

    /* =========================================================
     * 🪑 MESA / COMANDA
     * =======================================================*/
    socket.on("joinMesa", ({ mesaId } = {}) => {
      if (!mesaId) {
        console.log("⚠️ joinMesa sem mesaId");
        return;
      }
      safeJoin(`mesa-${mesaId}`);
    });

    /* =========================================================
     * ➕ ITEM ADICIONADO NA COMANDA
     * (emitido pelo controller)
     * =======================================================*/
    socket.on("itemAdicionadoMesa", ({ restauranteId, mesaId, pedido, mesa } = {}) => {
      if (!restauranteId || !mesaId) {
        console.log("⚠️ itemAdicionadoMesa faltando restauranteId/mesaId");
        return;
      }

      // ✅ mantém: atualizar a comanda só pra quem está na sala da mesa
      if (pedido) {
        io.to(`mesa-${mesaId}`).emit("comandaAtualizada", pedido);
      }

      // ✅ CORREÇÃO:
      // NÃO use "mesaAtualizada" com payload diferente do esperado no app.
      // Em vez disso, crie um evento próprio.
      io.to(`restaurante-${restauranteId}`).emit("mesaPedidoAtualizado", {
        mesaId,
        pedido: pedido || null,
      });

      // ✅ Se você também tiver o objeto mesa (recomendado), aí sim emita mesaAtualizada no formato certo:
      if (mesa && mesa._id) {
        io.to(`restaurante-${restauranteId}`).emit("mesaAtualizada", mesa);
      }
    });

    /* =========================================================
     * 🔓 MESA ABERTA
     * =======================================================*/
    socket.on("mesaAberta", ({ restauranteId, mesa } = {}) => {
      if (!restauranteId) return;

      // mantém seu evento atual
      io.to(`restaurante-${restauranteId}`).emit("mesaAberta", mesa);

      // ✅ opcional: se vier mesa completa, emite também mesaAtualizada (padroniza com o app)
      if (mesa && mesa._id) {
        io.to(`restaurante-${restauranteId}`).emit("mesaAtualizada", mesa);
      }
    });

    /* =========================================================
     * 🔒 MESA FECHADA
     * =======================================================*/
    socket.on("mesaFechada", ({ restauranteId, mesaId, mesa } = {}) => {
      if (!restauranteId || !mesaId) return;

      io.to(`mesa-${mesaId}`).emit("mesaFechada");
      io.to(`restaurante-${restauranteId}`).emit("mesaFechada", mesaId);

      // ✅ opcional: se vier mesa completa, atualiza o card no app
      if (mesa && mesa._id) {
        io.to(`restaurante-${restauranteId}`).emit("mesaAtualizada", mesa);
      }
    });

    /* =========================================================
     * 🚚 ENTREGADORES
     * =======================================================*/
    socket.on("joinEntregador", async ({ entregadorId, status = true } = {}) => {
      try {
        if (!entregadorId) return;

        const entregador = await Entregador.findById(entregadorId);
        if (!entregador) return;

        safeJoin(`entregador-${entregadorId}`);

        const restauranteId = String(entregador.restaurante || entregador.restauranteId || "");
        const estaDisponivel = Boolean(status);
        const agoraIso = new Date().toISOString();
        const loc = entregador.localizacao
          ? { ...entregador.localizacao, atualizadoEm: entregador.localizacao.atualizadoEm || agoraIso }
          : null;

        entregador.status = estaDisponivel;
        entregador.disponivel = estaDisponivel;
        await entregador.save();

        const pedidosAtivos = await Pedido.countDocuments({
          entregador: entregadorId,
          status: { $in: ["aguardando_resposta", "em_rota", "em_entrega"] },
        });

        const diaHoje = new Date().toISOString().split("T")[0];

        entregadoresOnline = entregadoresOnline.filter((e) => String(e.id || e._id || e.entregadorId) !== String(entregadorId));

        const payloadStatus = {
          id: String(entregador._id || entregador.id),
          _id: String(entregador._id || entregador.id),
          entregadorId: String(entregador._id || entregador.id),
          socketId: socket.id,
          nome: entregador.nome,
          email: entregador.email,
          restauranteId,
          localizacao: loc,
          status: estaDisponivel,
          disponivel: estaDisponivel,
          pedidosAtivos,
          atualizadoEm: agoraIso,
        };

        if (!estaDisponivel) {
          await EntregadorOnline.deleteOne({ entregadorId, dia: diaHoje });
        } else {
          entregadoresOnline.push(payloadStatus);

          await EntregadorOnline.findOneAndUpdate(
            { entregadorId, dia: diaHoje },
            {
              entregadorId,
              restauranteId: entregador.restaurante,
              dataEntrada: new Date(),
              dia: diaHoje,
              online: true,
              localizacao: loc,
            },
            { upsert: true }
          );
        }

        if (restauranteId) {
          io.to(`restaurante-${restauranteId}`).emit("delivererStatusUpdated", payloadStatus);
          emitirEntregadoresOnline(io, restauranteId);
        }
      } catch (err) {
        console.log("🔥 joinEntregador erro:", err?.message);
      }
    });

    socket.on("joinEntregadorSala", ({ entregadorId } = {}) => {
      if (!entregadorId) return;
      safeJoin(`entregador-${entregadorId}`);
    });

    const receberLocalizacaoMotorista = async (payload = {}) => {
      await atualizarLocalizacaoEntregadorSocket(io, { ...payload, socketId: socket.id });
    };

    // O app motorista antigo emitia "atualizarLocalizacao" e algumas versões
    // emitem "localizacaoAtualizada". Mantemos os dois para não perder rastreio.
    socket.on("atualizarLocalizacao", receberLocalizacaoMotorista);
    socket.on("localizacaoAtualizada", receberLocalizacaoMotorista);

    /* =========================================================
     * 📦 PEDIDOS DELIVERY (EXISTENTE)
     * =======================================================*/
    socket.on("enviarPedido", async ({ pedidoId, delivererId, restauranteId } = {}) => {
      try {
        if (!pedidoId || !delivererId || !restauranteId) return;

        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;

        const entregador = await Entregador.findById(delivererId);
        if (!entregador || idString(entregador.restaurante || entregador.restauranteId) !== String(restauranteId)) {
          io.to(`restaurante-${restauranteId}`).emit("pedidoEnvioErro", {
            pedidoId,
            delivererId,
            message: "Entregador invalido para este restaurante.",
          });
          return;
        }

        const limite = await obterLimitePedidosPorEntregador(restauranteId);
        const ativas = await contarEntregasAtivas(delivererId, pedidoId);
        if (ativas >= limite) {
          io.to(`restaurante-${restauranteId}`).emit("pedidoEnvioErro", {
            pedidoId,
            delivererId,
            limite,
            entregasAtivas: ativas,
            message: `Este entregador ja atingiu o limite de ${limite} entrega(s) ativa(s).`,
          });
          return;
        }

        const agora = new Date();
        const expiraEm = new Date(agora.getTime() + ENTREGA_ACEITE_TIMEOUT_MS);
        const solicitacaoId = criarSolicitacaoEntregaId();
        limparTimeoutPedido(pedidoId);

        pedido.entregador = delivererId;
        pedido.status = "aguardando_resposta";
        pedido.statusEntrega = "aguardando_aceite";
        pedido.statusAtualizadoEm = agora;
        pedido.direcionadoEm = agora;
        pedido.entregadorSolicitacaoId = solicitacaoId;
        pedido.entregadorAceiteExpiraEm = expiraEm;
        pedido.entregadorSolicitacao = {
          id: solicitacaoId,
          entregadorId: idString(delivererId),
          entregadorNome: entregador.nome,
          enviadoEm: agora.toISOString(),
          expiraEm: expiraEm.toISOString(),
          tempoAceiteSegundos: Math.ceil(ENTREGA_ACEITE_TIMEOUT_MS / 1000),
          alertaIntervaloSegundos: 15,
        };
        adicionarHistoricoEntrega(pedido, { tipo: "direcionado", entregadorId: idString(delivererId), entregadorNome: entregador.nome, solicitacaoId });
        await pedido.save();

        const payload = montarPayloadPedido(pedido, entregador);
        io.to(`entregador-${delivererId}`).emit("pedidoRecebido", payload);
        io.to(`entregador-${delivererId}`).emit("pedidoDirecionado", payload);
        io.to(`restaurante-${restauranteId}`).emit("pedidoEnviado", payload);
        io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", payload);

        const timeout = setTimeout(() => {
          expirarSolicitacaoEntregaSocket(io, { pedidoId, entregadorId: delivererId, solicitacaoId, restauranteId });
        }, ENTREGA_ACEITE_TIMEOUT_MS);
        if (typeof timeout.unref === "function") timeout.unref();
        timeoutsDePedidos.set(idString(pedidoId), timeout);
      } catch (err) {
        console.log("🔥 enviarPedido erro:", err?.message);
      }
    });

    socket.on("aceitarPedido", async ({ pedidoId, entregadorId } = {}) => {
      try {
        if (!pedidoId || !entregadorId) return;

        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;

        if (idString(pedido.entregador) !== idString(entregadorId) || pedido.status !== "aguardando_resposta") {
          io.to(`entregador-${entregadorId}`).emit("pedidoAceiteErro", { pedidoId, message: "Esta solicitação não está mais disponível." });
          return;
        }

        const expiraMs = pedido.entregadorAceiteExpiraEm ? new Date(pedido.entregadorAceiteExpiraEm).getTime() : 0;
        if (expiraMs && Date.now() > expiraMs) {
          await liberarPedidoParaNovoDirecionamento(io, {
            pedido,
            entregadorId,
            restauranteId: idString(pedido.restaurante),
            tipo: "timeout",
            motivo: "Motorista não aceitou em até 180 segundos.",
          });
          return;
        }

        const agora = new Date();
        pedido.entregador = entregadorId;
        pedido.status = "em_rota";
        pedido.statusEntrega = "aceito";
        pedido.aceitoEm = agora;
        pedido.entregadorAceitoEm = agora;
        pedido.statusAtualizadoEm = agora;
        adicionarHistoricoEntrega(pedido, { tipo: "aceito", entregadorId: idString(entregadorId), solicitacaoId: pedido.entregadorSolicitacaoId || "" });
        pedido.entregadorSolicitacaoId = null;
        pedido.entregadorSolicitacao = null;
        pedido.entregadorAceiteExpiraEm = null;
        await pedido.save();
        limparTimeoutPedido(pedidoId);

        const entregador = await Entregador.findById(entregadorId).lean().catch(() => null);
        const payload = montarPayloadPedido(pedido, entregador);
        io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAceito", payload);
        io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", payload);
        io.to(`entregador-${entregadorId}`).emit("pedidoAceito", payload);
      } catch (err) {
        console.log("🔥 aceitarPedido erro:", err?.message);
      }
    });

    socket.on("pedidoRecusado", async ({ pedidoId, entregadorId, motivo, tipo } = {}) => {
      try {
        if (!pedidoId || !entregadorId) return;
        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;
        if (idString(pedido.entregador) !== idString(entregadorId) || pedido.status !== "aguardando_resposta") {
          io.to(`entregador-${entregadorId}`).emit("pedidoRecusaErro", { pedidoId, message: "Esta solicitação já foi encerrada." });
          return;
        }
        await liberarPedidoParaNovoDirecionamento(io, {
          pedido,
          entregadorId,
          restauranteId: idString(pedido.restaurante),
          tipo: tipo === "timeout" ? "timeout" : "recusado",
          motivo: motivo || "Pedido recusado pelo entregador.",
        });
      } catch (err) {
        console.log("🔥 pedidoRecusado erro:", err?.message);
      }
    });

    socket.on("recusarPedido", async ({ pedidoId, entregadorId, motivo, tipo } = {}) => {
      try {
        if (!pedidoId || !entregadorId) return;
        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;
        if (idString(pedido.entregador) !== idString(entregadorId) || pedido.status !== "aguardando_resposta") {
          io.to(`entregador-${entregadorId}`).emit("pedidoRecusaErro", { pedidoId, message: "Esta solicitação já foi encerrada." });
          return;
        }
        await liberarPedidoParaNovoDirecionamento(io, {
          pedido,
          entregadorId,
          restauranteId: idString(pedido.restaurante),
          tipo: tipo === "timeout" ? "timeout" : "recusado",
          motivo: motivo || "Pedido recusado pelo entregador.",
        });
      } catch (err) {
        console.log("🔥 recusarPedido erro:", err?.message);
      }
    });

    socket.on("disconnect", () => {
      console.log("🔌 Desconectado:", socket.id);
      const afetados = entregadoresOnline.filter((e) => e.socketId === socket.id).map((e) => e.restauranteId).filter(Boolean);
      entregadoresOnline = entregadoresOnline.filter((e) => e.socketId !== socket.id);
      [...new Set(afetados)].forEach((restauranteId) => emitirEntregadoresOnline(io, restauranteId));
    });
  });
};
