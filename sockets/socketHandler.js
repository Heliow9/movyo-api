let entregadoresOnline = [];
const timeoutsDePedidos = new Map();

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const Restaurante = require("../models/Restaurante");
const axios = require("axios");

const STATUS_ENTREGA_ATIVA = ["aguardando_resposta", "em_rota", "em_entrega"];

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
        if (!entregador || idString(entregador.restaurante) !== String(restauranteId)) {
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

        pedido.entregador = delivererId;
        pedido.status = "aguardando_resposta";
        pedido.statusAtualizadoEm = new Date();
        await pedido.save();

        io.to(`entregador-${delivererId}`).emit("pedidoRecebido", pedido);
        io.to(`restaurante-${restauranteId}`).emit("pedidoEnviado", pedido);
        io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);

        const timeout = setTimeout(async () => {
          const p = await Pedido.findById(pedidoId);
          if (p?.status === "aguardando_resposta") {
            p.status = "em_entrega";
            p.entregador = null;
            await p.save();

            io.to(`restaurante-${restauranteId}`).emit("pedidoNaoAceito", p);
          }
        }, 2 * 60 * 1000);

        timeoutsDePedidos.set(pedidoId, timeout);
      } catch (err) {
        console.log("🔥 enviarPedido erro:", err?.message);
      }
    });

    socket.on("aceitarPedido", async ({ pedidoId, entregadorId } = {}) => {
      try {
        if (!pedidoId || !entregadorId) return;

        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;

        pedido.entregador = entregadorId;
        pedido.status = "em_rota";
        pedido.aceitoEm = new Date();
        pedido.statusAtualizadoEm = new Date();
        await pedido.save();

        io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAceito", pedido);
        io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", pedido);
        io.to(`entregador-${entregadorId}`).emit("pedidoAceito", pedido);

        if (timeoutsDePedidos.has(pedidoId)) {
          clearTimeout(timeoutsDePedidos.get(pedidoId));
          timeoutsDePedidos.delete(pedidoId);
        }
      } catch (err) {
        console.log("🔥 aceitarPedido erro:", err?.message);
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
