let entregadoresOnline = [];
const timeoutsDePedidos = new Map();

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const axios = require("axios");

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

        const pedidosAtivos = await Pedido.countDocuments({
          entregador: entregadorId,
          status: { $in: ["aguardando_resposta", "em_rota", "em_entrega"] },
        });

        const diaHoje = new Date().toISOString().split("T")[0];

        if (!status) {
          entregadoresOnline = entregadoresOnline.filter((e) => e.id !== entregadorId);
          await EntregadorOnline.deleteOne({ entregadorId, dia: diaHoje });
        } else {
          entregadoresOnline = entregadoresOnline.filter((e) => e.id !== entregadorId);

          entregadoresOnline.push({
            id: entregadorId,
            socketId: socket.id,
            nome: entregador.nome,
            email: entregador.email,
            restauranteId: entregador.restaurante?.toString(),
            localizacao: entregador.localizacao,
            status: true,
            pedidosAtivos,
          });

          await EntregadorOnline.findOneAndUpdate(
            { entregadorId, dia: diaHoje },
            {
              entregadorId,
              restauranteId: entregador.restaurante,
              dataEntrada: new Date(),
              dia: diaHoje,
            },
            { upsert: true }
          );
        }

        io.to(`restaurante-${entregador.restaurante}`).emit(
          "deliverersOnline",
          entregadoresOnline.filter(
            (e) => e.restauranteId === entregador.restaurante.toString()
          )
        );
      } catch (err) {
        console.log("🔥 joinEntregador erro:", err?.message);
      }
    });

    socket.on("joinEntregadorSala", ({ entregadorId } = {}) => {
      if (!entregadorId) return;
      safeJoin(`entregador-${entregadorId}`);
    });

    socket.on("localizacaoAtualizada", async ({ entregadorId, latitude, longitude } = {}) => {
      try {
        if (!entregadorId) return;

        const entregador = await Entregador.findById(entregadorId);
        if (!entregador) return;

        entregador.localizacao = { latitude, longitude };
        await entregador.save();

        io.to(`entregador-${entregadorId}`).emit("atualizacaoLocalizacao", {
          latitude,
          longitude,
        });

        io.to(`restaurante-${entregador.restaurante}`).emit(
          "deliverersOnline",
          entregadoresOnline.map((e) =>
            e.id === entregadorId
              ? { ...e, localizacao: { latitude, longitude } }
              : e
          )
        );
      } catch (err) {
        console.log("🔥 localizacaoAtualizada erro:", err?.message);
      }
    });

    /* =========================================================
     * 📦 PEDIDOS DELIVERY (EXISTENTE)
     * =======================================================*/
    socket.on("enviarPedido", async ({ pedidoId, delivererId, restauranteId } = {}) => {
      try {
        if (!pedidoId || !delivererId || !restauranteId) return;

        const pedido = await Pedido.findById(pedidoId);
        if (!pedido) return;

        pedido.entregador = delivererId;
        pedido.status = "aguardando_resposta";
        await pedido.save();

        io.to(`entregador-${delivererId}`).emit("pedidoRecebido", pedido);
        io.to(`restaurante-${restauranteId}`).emit("pedidoEnviado", pedido);

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

        pedido.status = "em_rota";
        await pedido.save();

        io.to(`restaurante-${pedido.restaurante}`).emit("pedidoAceito", pedido);
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
      entregadoresOnline = entregadoresOnline.filter((e) => e.socketId !== socket.id);
    });
  });
};
