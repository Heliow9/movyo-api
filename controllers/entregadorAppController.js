const crypto = require("crypto");

const Pedido = require("../models/Pedido");
const Entregador = require("../models/Entregador");
const Restaurante = require("../models/Restaurante");
const { calcularDistanciaEntrega } = require("../services/distanciaService");
const {
  aceitarOferta,
  recusarOferta,
} = require("../services/deliveryOfferService");
const {
  atualizarStatusJornada,
  registrarLocalizacao,
  obterJornadaHoje,
  segundosOnline,
} = require("../services/entregadorJornadaService");
const { enviarMensagem } = require("../utils/bot");
const { formatOperationalDateISO } = require("../utils/operationalDateTime");

function idString(value) {
  return String(value?._id || value?.id || value || "");
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizePayment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isCashPayment(pedido) {
  const value = normalizePayment(
    pedido?.formaPagamento ||
      pedido?.formadePagamento ||
      pedido?.pagamento?.forma ||
      pedido?.pagamento?.metodo
  );
  return value.includes("dinheiro") || value.includes("cash");
}

function sanitizeEntregador(entregador) {
  const plain =
    entregador && typeof entregador.toObject === "function"
      ? entregador.toObject()
      : { ...(entregador || {}) };
  delete plain.senha;
  return plain;
}

function ensureOwnPedido(pedido, entregadorId) {
  if (!pedido) {
    const error = new Error("Pedido nao encontrado.");
    error.status = 404;
    throw error;
  }
  if (idString(pedido.entregador) !== idString(entregadorId)) {
    const error = new Error("Este pedido nao pertence ao motorista autenticado.");
    error.status = 403;
    throw error;
  }
}

function sendError(res, error, fallback) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    message: error?.message || fallback,
  });
}

async function me(req, res) {
  return res.json({
    ok: true,
    entregador: sanitizeEntregador(req.entregador),
    restaurante: req.restauranteMotorista
      ? {
          _id: idString(req.restauranteMotorista),
          nome: req.restauranteMotorista.nome,
          plano: req.restauranteMotorista.plano,
        }
      : null,
  });
}

async function estado(req, res) {
  try {
    const entregadorId = idString(req.entregador);
    const pedidos = await Pedido.find({ entregador: entregadorId }).lean();
    const ofertas = pedidos.filter(
      (pedido) =>
        pedido.status === "aguardando_resposta" &&
        pedido.ofertaEntrega?.status === "aguardando"
    );
    const aceitos = pedidos.filter((pedido) =>
      ["em_rota", "em_entrega"].includes(String(pedido.status || ""))
    );
    return res.json({ ok: true, ofertas, aceitos });
  } catch (error) {
    return sendError(res, error, "Erro ao sincronizar entregas.");
  }
}

async function status(req, res) {
  try {
    const online =
      req.body?.online === true ||
      String(req.body?.status || "").toLowerCase() === "online";
    const jornada = await atualizarStatusJornada(req.entregador, online);
    const entregador = await Entregador.findById(req.entregador._id);
    const payload = {
      id: idString(entregador),
      nome: entregador.nome,
      email: entregador.email,
      restauranteId: idString(entregador.restaurante),
      localizacao: entregador.localizacao,
      status: online,
      onlineDesde: jornada.onlineDesde || null,
    };
    req.io
      ?.to(`restaurante-${payload.restauranteId}`)
      .emit("motoristaStatusAtualizado", payload);
    return res.json({
      ok: true,
      online,
      jornada,
      entregador: sanitizeEntregador(entregador),
    });
  } catch (error) {
    return sendError(res, error, "Erro ao atualizar disponibilidade.");
  }
}

async function localizacao(req, res) {
  try {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "Latitude e longitude sao obrigatorias." });
    }

    const restaurante = req.restauranteMotorista ||
      (await Restaurante.findById(req.entregador.restaurante).lean());
    const distanciaLoja = await calcularDistanciaEntrega(
      latitude,
      longitude,
      restaurante?.localizacao || {}
    );
    const atualizacao = await registrarLocalizacao(req.entregador, {
      latitude,
      longitude,
      accuracy: Number(req.body?.accuracy || 0) || null,
      speed: Number(req.body?.speed || 0) || null,
      heading: Number(req.body?.heading || 0) || null,
    });

    const payload = {
      entregadorId: idString(req.entregador),
      email: req.entregador.email,
      latitude,
      longitude,
      distancia: distanciaLoja === null ? null : round2(distanciaLoja),
      distanciaPercorridaKm: round2(atualizacao.jornada.distanciaPercorridaKm),
      atualizadoEm: new Date(),
    };
    req.io
      ?.to(`restaurante-${idString(req.entregador.restaurante)}`)
      .emit("localizacaoAtualizada", payload);
    req.io
      ?.to(`entregador-${idString(req.entregador)}`)
      .emit("atualizacaoLocalizacao", payload);

    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, "Erro ao atualizar localizacao.");
  }
}

async function token(req, res) {
  try {
    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    if (!/^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(expoPushToken)) {
      return res.status(400).json({ message: "Token Expo Push invalido." });
    }
    await Entregador.findByIdAndUpdate(req.entregador._id, { expoPushToken });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, "Erro ao salvar token push.");
  }
}

async function aceitar(req, res) {
  try {
    const pedido = await aceitarOferta({
      pedidoId: req.params.pedidoId,
      entregadorId: req.entregador._id,
      io: req.io,
    });
    return res.json({
      ok: true,
      pedido,
      segundosResposta: pedido.ofertaEntrega?.segundosResposta || 0,
    });
  } catch (error) {
    return sendError(res, error, "Nao foi possivel aceitar a entrega.");
  }
}

async function recusar(req, res) {
  try {
    const pedido = await recusarOferta({
      pedidoId: req.params.pedidoId,
      entregadorId: req.entregador._id,
      motivo: req.body?.motivo,
      io: req.io,
    });
    return res.json({
      ok: true,
      pedido,
      segundosResposta: pedido.ofertaEntrega?.segundosResposta || 0,
    });
  } catch (error) {
    return sendError(res, error, "Nao foi possivel recusar a entrega.");
  }
}

async function iniciar(req, res) {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    ensureOwnPedido(pedido, req.entregador._id);
    if (!["em_rota", "em_entrega"].includes(String(pedido.status || ""))) {
      return res.status(409).json({ message: "Entrega ainda nao foi aceita." });
    }

    const agora = new Date();
    const trackingToken =
      pedido.linkEntrega?.token || crypto.randomBytes(16).toString("hex");
    const expiracao = new Date(agora.getTime() + 4 * 60 * 60 * 1000);
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
    const jornada = await obterJornadaHoje(req.entregador, true);

    pedido.status = "em_entrega";
    pedido.emEntregaEm = pedido.emEntregaEm || agora;
    pedido.statusAtualizadoEm = agora;
    pedido.linkEntrega = { token: trackingToken, expiracao };
    pedido.comprovanteEntrega = {
      status: "pendente",
      pinHash,
      pinGeradoEm: agora,
      distanciaInicioKm: Number(jornada?.distanciaPercorridaKm || 0),
    };
    await pedido.save();

    const clienteUrl = String(
      process.env.CLIENTE_URL || "https://movyo.delivery"
    ).replace(/\/+$/, "");
    const link = `${clienteUrl}/acompanhar/${trackingToken}`;
    let mensagemEnviada = false;
    if (pedido.telefoneCliente) {
      try {
        await enviarMensagem(
          pedido.restaurante,
          pedido.telefoneCliente,
          `Seu pedido esta a caminho. Codigo de confirmacao: ${pin}. Acompanhe: ${link}`
        );
        mensagemEnviada = true;
      } catch (error) {
        console.warn("Falha ao enviar PIN da entrega:", error?.message || error);
      }
    }

    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("entregaIniciada", { pedido, pinEnviado: mensagemEnviada });
    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("pedidoAtualizado", pedido);
    return res.json({
      ok: true,
      pedido,
      link,
      pinEnviado: mensagemEnviada,
    });
  } catch (error) {
    return sendError(res, error, "Nao foi possivel iniciar a entrega.");
  }
}

async function ocorrencia(req, res) {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    ensureOwnPedido(pedido, req.entregador._id);
    const tipo = String(req.body?.tipo || "").trim();
    if (!tipo) return res.status(400).json({ message: "Informe o tipo da ocorrencia." });

    const nova = {
      tipo: tipo.slice(0, 80),
      descricao: String(req.body?.descricao || "").trim().slice(0, 500),
      criadoEm: new Date(),
      latitude: Number(req.body?.latitude) || null,
      longitude: Number(req.body?.longitude) || null,
      entregadorId: idString(req.entregador),
      entregadorNome: req.entregador.nome,
    };
    pedido.ocorrenciasEntrega = [
      ...(Array.isArray(pedido.ocorrenciasEntrega) ? pedido.ocorrenciasEntrega : []),
      nova,
    ];
    await pedido.save();
    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("entregaOcorrencia", { pedido, ocorrencia: nova });
    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("pedidoAtualizado", pedido);
    return res.json({ ok: true, pedido, ocorrencia: nova });
  } catch (error) {
    return sendError(res, error, "Nao foi possivel registrar a ocorrencia.");
  }
}

function parseSignature(value) {
  if (!value) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const paths = Array.isArray(parsed?.paths) ? parsed.paths : [];
  if (!paths.length || paths.length > 40) return null;
  const normalized = paths.map((path) =>
    (Array.isArray(path) ? path : [])
      .slice(0, 500)
      .map((point) => ({
        x: round2(point?.x),
        y: round2(point?.y),
      }))
  );
  return {
    paths: normalized,
    width: Math.max(1, Number(parsed?.width || 320)),
    height: Math.max(1, Number(parsed?.height || 180)),
  };
}

async function concluir(req, res) {
  try {
    const pedido = await Pedido.findById(req.params.pedidoId);
    ensureOwnPedido(pedido, req.entregador._id);
    if (!["em_rota", "em_entrega"].includes(String(pedido.status || ""))) {
      return res.status(409).json({ message: "Esta entrega nao esta em andamento." });
    }

    const tipo = String(req.body?.tipo || "").toLowerCase();
    const pendente = pedido.comprovanteEntrega || {};
    let proof = null;

    if (tipo === "pin") {
      const pin = String(req.body?.pin || "").trim();
      const pinHash = crypto.createHash("sha256").update(pin).digest("hex");
      if (!/^\d{4}$/.test(pin) || !pendente.pinHash || pinHash !== pendente.pinHash) {
        return res.status(422).json({ message: "PIN de entrega incorreto." });
      }
      proof = { tipo: "pin", pinValidado: true };
    } else if (tipo === "foto") {
      if (!req.file) {
        return res.status(422).json({ message: "Tire ou selecione a foto da entrega." });
      }
      proof = {
        tipo: "foto",
        fotoUrl: `/uploads/comprovantes-entrega/${req.file.filename}`,
      };
    } else if (tipo === "assinatura") {
      let assinatura = null;
      try {
        assinatura = parseSignature(req.body?.assinatura);
      } catch {
        assinatura = null;
      }
      if (!assinatura) {
        return res.status(422).json({ message: "Assinatura invalida ou vazia." });
      }
      proof = { tipo: "assinatura", assinatura };
    } else {
      return res.status(422).json({
        message: "Escolha PIN, foto ou assinatura para concluir.",
      });
    }

    const agora = new Date();
    const jornada = await obterJornadaHoje(req.entregador, true);
    const distanciaInicio = Number(pendente.distanciaInicioKm || 0);
    const distanciaFim = Number(jornada?.distanciaPercorridaKm || 0);
    const recebeuValorInformado = String(req.body?.valorRecebido ?? "").trim() !== "";
    const valorRecebidoInformado = Number(req.body?.valorRecebido);
    const valorRecebido = recebeuValorInformado && Number.isFinite(valorRecebidoInformado)
      ? Math.max(0, valorRecebidoInformado)
      : isCashPayment(pedido)
        ? Number(pedido.valorTotal || pedido.total || 0)
        : 0;

    pedido.status = "entregue";
    pedido.entregueEm = agora;
    pedido.statusAtualizadoEm = agora;
    pedido.tempoEntregaSegundos = pedido.emEntregaEm
      ? Math.max(0, Math.round((agora - new Date(pedido.emEntregaEm)) / 1000))
      : 0;
    pedido.distanciaPercorridaKm = round2(
      Math.max(0, distanciaFim - distanciaInicio)
    );
    pedido.valorRecebidoMotorista = round2(valorRecebido);
    pedido.comprovanteEntrega = {
      ...proof,
      status: "validado",
      concluidoEm: agora,
      entregadorId: idString(req.entregador),
      entregadorNome: req.entregador.nome,
      latitude: Number(req.body?.latitude) || null,
      longitude: Number(req.body?.longitude) || null,
    };
    await pedido.save();

    if (jornada) {
      jornada.valorRecebido =
        Number(jornada.valorRecebido || 0) + Number(pedido.valorRecebidoMotorista || 0);
      await jornada.save();
    }

    const payload = { pedido, comprovante: pedido.comprovanteEntrega };
    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("entregaConcluida", payload);
    req.io
      ?.to(`restaurante-${idString(pedido.restaurante)}`)
      .emit("pedidoAtualizado", pedido);
    req.io
      ?.to(`entregador-${idString(req.entregador)}`)
      .emit("entregaConcluida", payload);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, "Nao foi possivel concluir a entrega.");
  }
}

async function resumoDia(req, res) {
  try {
    const entregadorId = idString(req.entregador);
    const dia = formatOperationalDateISO();
    const entregas = (await Pedido.find({
      entregador: entregadorId,
      status: "entregue",
    }).lean()).filter(
      (pedido) =>
        formatOperationalDateISO(pedido.entregueEm || pedido.updatedAt) === dia
    );
    const jornada = await obterJornadaHoje(req.entregador, true);
    const valorEntregue = entregas.reduce(
      (total, pedido) => total + Number(pedido.valorTotal || pedido.total || 0),
      0
    );
    const valorRecebido = entregas.reduce(
      (total, pedido) => total + Number(pedido.valorRecebidoMotorista || 0),
      0
    );
    const tempoMedioEntregaSegundos = entregas.length
      ? Math.round(
          entregas.reduce(
            (total, pedido) => total + Number(pedido.tempoEntregaSegundos || 0),
            0
          ) / entregas.length
        )
      : 0;

    return res.json({
      ok: true,
      dia,
      online: jornada?.online === true,
      entregasHoje: entregas.length,
      distanciaPercorridaKm: round2(jornada?.distanciaPercorridaKm || 0),
      segundosOnline: segundosOnline(jornada),
      valorEntregue: round2(valorEntregue),
      valorRecebido: round2(valorRecebido),
      tempoMedioEntregaSegundos,
    });
  } catch (error) {
    return sendError(res, error, "Erro ao gerar resumo do motorista.");
  }
}

module.exports = {
  me,
  estado,
  status,
  localizacao,
  token,
  aceitar,
  recusar,
  iniciar,
  ocorrencia,
  concluir,
  resumoDia,
};
