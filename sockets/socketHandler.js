let entregadoresOnline = [];
const timeoutsDePedidos = new Map();
const locationWriteStates = new Map();

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const Restaurante = require("../models/Restaurante");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { enviarOferta, aceitarOferta, recusarOferta } = require("../services/deliveryOfferService");
const { atualizarStatusJornada, registrarLocalizacao } = require("../services/entregadorJornadaService");

const STATUS_ENTREGA_ATIVA = ["aguardando_resposta", "em_rota", "em_entrega"];
const SOCKET_DEBUG = String(process.env.SOCKET_DEBUG || "").toLowerCase() === "true";
const SOCKET_REQUIRE_AUTH = String(process.env.SOCKET_REQUIRE_AUTH || "").toLowerCase() === "true";
const LOCATION_PERSIST_INTERVAL_MS = Math.max(1000, Number(process.env.LOCATION_PERSIST_INTERVAL_MS || 3000));
const LOCATION_MAX_EVENTS_PER_SECOND = Math.max(1, Number(process.env.LOCATION_MAX_EVENTS_PER_SECOND || 5));

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
      if (SOCKET_REQUIRE_AUTH) return next(new Error("AUTH_OBRIGATORIA"));
      socket.data.auth = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.auth = decoded;
      let role = String(decoded.role || "").toLowerCase();
      const decodedId = decoded.id || decoded._id;
      if (!role && decodedId) {
        const legacyDriver = await Entregador.findById(decodedId).lean().catch(() => null);
        role = legacyDriver ? "entregador" : "restaurante";
      }
      socket.data.role = role || "restaurante";
      socket.data.restauranteId = idString(
        decoded.restauranteId || decoded.idRestaurante || decoded.restaurante?._id || decoded._id || decoded.id
      );
      socket.data.entregadorId = socket.data.role === "entregador"
        ? idString(decoded.entregadorId || decoded._id || decoded.id)
        : "";
      return next();
    } catch (error) {
      return next(new Error("AUTH_INVALIDA"));
    }
  });

  io.on("connection", (socket) => {
    if (SOCKET_DEBUG) console.log("Socket conectado:", socket.id);

    const canAccessRestaurante = (restauranteId) => {
      const requested = idString(restauranteId);
      if (!requested) return false;
      if (!socket.data.auth) return !SOCKET_REQUIRE_AUTH;
      return idString(socket.data.restauranteId) === requested;
    };

    const rejectUnauthorizedRoom = (ack, message = "Sala nao autorizada.") => {
      ack?.({ ok: false, message });
    };

    const safeJoin = (room) => {
      if (!room) return;
      socket.join(room);
      if (SOCKET_DEBUG) console.log(`join: ${socket.id} -> ${room}`);
    };

    /* =========================================================
     * 🏪 RESTAURANTE
     * =======================================================*/
    socket.on("joinRestaurante", ({ restauranteId } = {}, ack) => {
      if (!restauranteId) {
        return rejectUnauthorizedRoom(ack, "restauranteId obrigatorio.");
      }
      if (!canAccessRestaurante(restauranteId)) return rejectUnauthorizedRoom(ack);

      const room = `restaurante-${restauranteId}`;
      safeJoin(room);

      socket.emit(
        "deliverersOnline",
        entregadoresOnline.filter((e) => e.restauranteId === String(restauranteId))
      );
      ack?.({ ok: true });
    });

    /* =========================================================
     * 🪑 MESA / COMANDA
     * =======================================================*/
    socket.on("joinMesa", ({ mesaId } = {}, ack) => {
      if (!mesaId) {
        return rejectUnauthorizedRoom(ack, "mesaId obrigatorio.");
      }
      if (SOCKET_REQUIRE_AUTH && !socket.data.auth) return rejectUnauthorizedRoom(ack);
      safeJoin(`mesa-${mesaId}`);
      ack?.({ ok: true });
    });

    /* =========================================================
     * ➕ ITEM ADICIONADO NA COMANDA
     * (emitido pelo controller)
     * =======================================================*/
    socket.on("itemAdicionadoMesa", ({ restauranteId, mesaId, pedido, mesa } = {}) => {
      if (!restauranteId || !mesaId) {
        return;
      }
      if (!canAccessRestaurante(restauranteId)) return;

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
      if (!canAccessRestaurante(restauranteId)) return;

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
      if (!canAccessRestaurante(restauranteId)) return;

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
        socket.data.entregador = entregador;
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
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return ack?.({ ok: false, message: "Localizacao invalida." });
        }

        const now = Date.now();
        const rate = socket.data.locationRate || { windowStartedAt: now, count: 0 };
        if (now - rate.windowStartedAt >= 1000) {
          rate.windowStartedAt = now;
          rate.count = 0;
        }
        rate.count += 1;
        socket.data.locationRate = rate;
        if (rate.count > LOCATION_MAX_EVENTS_PER_SECOND) {
          return ack?.({ ok: true, throttled: true });
        }

        const entregador = socket.data.entregador || await Entregador.findById(authId);
        if (!entregador) return ack?.({ ok: false, message: "Motorista nao encontrado." });
        socket.data.entregador = entregador;
        const restauranteId = idString(entregador.restaurante);
        const localizacao = { latitude: lat, longitude: lng };
        entregador.localizacao = localizacao;
        entregadoresOnline = entregadoresOnline.map((item) =>
          item.id === authId ? { ...item, localizacao } : item
        );
        const payload = {
          entregadorId: authId,
          latitude: lat,
          longitude: lng,
          distanciaPercorridaKm: Number(socket.data.distanciaPercorridaKm || 0),
          atualizadoEm: new Date(),
        };
        io.to(`entregador-${authId}`).volatile.emit("atualizacaoLocalizacao", payload);
        io.to(`restaurante-${restauranteId}`).volatile.emit("localizacaoAtualizada", payload);

        const state = locationWriteStates.get(authId) || {
          lastPersistAt: 0,
          pending: null,
          timer: null,
          inFlight: false,
        };
        state.pending = { entregador, localizacao, socket };
        locationWriteStates.set(authId, state);

        const flushLocation = async () => {
          if (state.inFlight || !state.pending) return;
          const current = state.pending;
          state.pending = null;
          state.inFlight = true;
          state.timer = null;
          try {
            const { jornada } = await registrarLocalizacao(current.entregador, current.localizacao);
            state.lastPersistAt = Date.now();
            current.socket.data.distanciaPercorridaKm = Number(jornada.distanciaPercorridaKm || 0);
          } catch (error) {
            console.warn("Persistencia de localizacao falhou:", error?.message || error);
          } finally {
            state.inFlight = false;
            if (state.pending && !state.timer) {
              state.timer = setTimeout(() => {
                state.timer = null;
                void flushLocation();
              }, LOCATION_PERSIST_INTERVAL_MS);
              state.timer.unref?.();
            } else if (!state.pending && !current.socket.connected) {
              locationWriteStates.delete(authId);
            }
          }
        };

        const elapsed = now - state.lastPersistAt;
        if (!state.inFlight && elapsed >= LOCATION_PERSIST_INTERVAL_MS) {
          void flushLocation();
        } else if (!state.timer) {
          state.timer = setTimeout(() => {
            state.timer = null;
            void flushLocation();
          }, Math.max(1, LOCATION_PERSIST_INTERVAL_MS - elapsed));
          state.timer.unref?.();
        }
        ack?.({ ok: true, queued: true });
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
      if (SOCKET_DEBUG) console.log("Socket desconectado:", socket.id);
      const removed = entregadoresOnline.find((e) => e.socketId === socket.id);
      entregadoresOnline = entregadoresOnline.filter((e) => e.socketId !== socket.id);
      if (removed?.restauranteId) {
        io.to(`restaurante-${removed.restauranteId}`).emit(
          "deliverersOnline",
          entregadoresOnline.filter((e) => e.restauranteId === removed.restauranteId)
        );
      }
    });
  });
};
