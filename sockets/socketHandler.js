let entregadoresOnline = [];
const timeoutsDePedidos = new Map();

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const Restaurante = require("../models/Restaurante");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { enviarOferta, aceitarOferta, recusarOferta } = require("../services/deliveryOfferService");
const { atualizarStatusJornada, registrarLocalizacao } = require("../services/entregadorJornadaService");

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

module.exports = (io) => {
  io.use(async (socket, next) => {
    const token = String(
      socket.handshake?.auth?.token || socket.handshake?.query?.token || ""
    ).replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      socket.data.auth = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.auth = decoded;
      let role = String(decoded.role || "").toLowerCase();
      if (!role && decoded.id) {
        const legacyDriver = await Entregador.findById(decoded.id).lean().catch(() => null);
        role = legacyDriver ? "entregador" : "restaurante";
      }
      socket.data.role = role || "restaurante";
      socket.data.restauranteId = idString(decoded.restauranteId || decoded.idRestaurante || decoded.id);
      socket.data.entregadorId = socket.data.role === "entregador"
        ? idString(decoded.entregadorId || decoded.id)
        : "";
      return next();
    } catch (error) {
      return next(new Error("AUTH_INVALIDA"));
    }
  });

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
    socket.on("joinEntregador", async ({ entregadorId, status = true } = {}, ack) => {
      try {
        const authId = idString(socket.data.entregadorId);
        if (!authId || socket.data.role !== "entregador" || authId !== idString(entregadorId)) {
          ack?.({ ok: false, message: "Motorista nao autenticado para esta sala." });
          return;
        }
        const entregador = await Entregador.findById(authId);
        if (!entregador) return ack?.({ ok: false, message: "Motorista nao encontrado." });
        safeJoin(`entregador-${authId}`);
        await atualizarStatusJornada(entregador, status !== false);
        entregadoresOnline = entregadoresOnline.filter((e) => e.id !== authId);
        if (status !== false) {
          const pedidosAtivos = await Pedido.countDocuments({
            entregador: authId,
            status: { $in: STATUS_ENTREGA_ATIVA },
          });
          entregadoresOnline.push({
            id: authId,
            socketId: socket.id,
            nome: entregador.nome,
            email: entregador.email,
            restauranteId: idString(entregador.restaurante),
            localizacao: entregador.localizacao,
            status: true,
            pedidosAtivos,
          });
        }
        const lista = entregadoresOnline.filter((e) => e.restauranteId === idString(entregador.restaurante));
        io.to(`restaurante-${idString(entregador.restaurante)}`).emit("deliverersOnline", lista);
        io.to(`entregador-${authId}`).emit("entregadoresOnline", lista);
        ack?.({ ok: true, online: status !== false });
      } catch (error) {
        console.log("joinEntregador erro:", error?.message);
        ack?.({ ok: false, message: error?.message || "Erro ao entrar na sala." });
      }
    });

    socket.on("joinEntregadorSala", ({ entregadorId } = {}, ack) => {
      const authId = idString(socket.data.entregadorId);
      if (!authId || socket.data.role !== "entregador" || authId !== idString(entregadorId)) {
        return ack?.({ ok: false, message: "Sala de motorista nao autorizada." });
      }
      safeJoin(`entregador-${authId}`);
      ack?.({ ok: true });
    });

    const handleLocalizacaoMotorista = async ({ entregadorId, latitude, longitude } = {}, ack) => {
      try {
        const authId = idString(socket.data.entregadorId);
        if (!authId || socket.data.role !== "entregador" || authId !== idString(entregadorId)) {
          return ack?.({ ok: false, message: "Localizacao nao autorizada." });
        }
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return ack?.({ ok: false, message: "Localizacao invalida." });
        }
        const entregador = await Entregador.findById(authId);
        if (!entregador) return ack?.({ ok: false, message: "Motorista nao encontrado." });
        const { jornada } = await registrarLocalizacao(entregador, { latitude: lat, longitude: lng });
        entregadoresOnline = entregadoresOnline.map((item) =>
          item.id === authId ? { ...item, localizacao: { latitude: lat, longitude: lng } } : item
        );
        const payload = {
          entregadorId: authId,
          latitude: lat,
          longitude: lng,
          distanciaPercorridaKm: Number(jornada.distanciaPercorridaKm || 0),
          atualizadoEm: new Date(),
        };
        io.to(`entregador-${authId}`).emit("atualizacaoLocalizacao", payload);
        io.to(`restaurante-${idString(entregador.restaurante)}`).emit("localizacaoAtualizada", payload);
        io.to(`restaurante-${idString(entregador.restaurante)}`).emit(
          "deliverersOnline",
          entregadoresOnline.filter((e) => e.restauranteId === idString(entregador.restaurante))
        );
        ack?.({ ok: true });
      } catch (error) {
        console.log("localizacao motorista erro:", error?.message);
        ack?.({ ok: false, message: error?.message || "Erro de localizacao." });
      }
    };

    socket.on("localizacaoAtualizada", handleLocalizacaoMotorista);
    socket.on("atualizarLocalizacao", handleLocalizacaoMotorista);

    /* =========================================================
     * PEDIDOS DELIVERY (EXISTENTE)
     * =======================================================*/
    socket.on("enviarPedido", async ({ pedidoId, delivererId, restauranteId } = {}, ack) => {
      try {
        const authRestauranteId = idString(socket.data.restauranteId);
        if (socket.data.role === "entregador" || !authRestauranteId || authRestauranteId !== idString(restauranteId)) {
          return ack?.({ ok: false, message: "Restaurante nao autorizado." });
        }
        const result = await enviarOferta({
          pedidoId,
          entregadorId: delivererId,
          restauranteId,
          io,
          origem: "desktop_socket",
        });
        ack?.({ ok: true, pedido: result.pedido });
      } catch (error) {
        io.to(`restaurante-${idString(restauranteId)}`).emit("pedidoEnvioErro", {
          pedidoId,
          delivererId,
          message: error?.message || "Erro ao enviar pedido.",
        });
        ack?.({ ok: false, message: error?.message || "Erro ao enviar pedido." });
      }
    });

    socket.on("aceitarPedido", async ({ pedidoId, entregadorId } = {}, ack) => {
      try {
        const authId = idString(socket.data.entregadorId);
        if (!authId || socket.data.role !== "entregador" || authId !== idString(entregadorId)) {
          return ack?.({ ok: false, message: "Aceite nao autorizado." });
        }
        const pedido = await aceitarOferta({ pedidoId, entregadorId: authId, io });
        ack?.({ ok: true, pedido });
      } catch (error) {
        ack?.({ ok: false, message: error?.message || "Erro ao aceitar pedido." });
      }
    });

    socket.on("pedidoRecusado", async ({ pedidoId, entregadorId, motivo } = {}, ack) => {
      try {
        const authId = idString(socket.data.entregadorId);
        if (!authId || socket.data.role !== "entregador" || authId !== idString(entregadorId)) {
          return ack?.({ ok: false, message: "Recusa nao autorizada." });
        }
        const pedido = await recusarOferta({ pedidoId, entregadorId: authId, motivo, io });
        ack?.({ ok: true, pedido });
      } catch (error) {
        ack?.({ ok: false, message: error?.message || "Erro ao recusar pedido." });
      }
    });

    socket.on("disconnect", () => {
      console.log("🔌 Desconectado:", socket.id);
      entregadoresOnline = entregadoresOnline.filter((e) => e.socketId !== socket.id);
    });
  });
};
