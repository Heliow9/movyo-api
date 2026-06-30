const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Entregador = require("../models/Entregador");
const Restaurante = require("../models/Restaurante");
const { calcularDistanciaEntrega } = require("../services/distanciaService");
const { planHasFeature } = require("../utils/planRules");

function idString(value) {
  return String(value?._id || value?.id || value || "");
}

function sanitize(entregador) {
  const plain = entregador && typeof entregador.toObject === "function"
    ? entregador.toObject()
    : { ...(entregador || {}) };
  delete plain.senha;
  return plain;
}

function sameRestaurant(req, entregador) {
  return idString(req.restauranteId) === idString(entregador?.restaurante);
}

const register = async (req, res) => {
  const { nome, email, senha, cpf } = req.body;
  const restauranteId = idString(req.restauranteId || req.body?.restauranteId);
  if (!nome || !email || !senha || !cpf || !restauranteId) {
    return res.status(400).json({ error: "Nome, email, senha, CPF e restaurante sao obrigatorios." });
  }

  try {
    const entregadorExistente = await Entregador.findOne({ email });
    if (entregadorExistente) {
      return res.status(400).json({ error: "Este email ja esta vinculado a outro motorista." });
    }
    const cpfExistente = await Entregador.findOne({ cpf });
    if (cpfExistente) {
      return res.status(400).json({ error: "Este CPF ja esta vinculado a outro motorista." });
    }

    const novoEntregador = await Entregador.create({
      nome: String(nome).trim(),
      email: String(email).trim().toLowerCase(),
      senha: await bcrypt.hash(senha, 10),
      restaurante: restauranteId,
      cpf: String(cpf).trim(),
      statusConta: "ativo",
      status: false,
      disponivel: false,
    });
    return res.status(201).json({
      message: "Motorista cadastrado com sucesso.",
      entregador: sanitize(novoEntregador),
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao cadastrar motorista.", details: error.message });
  }
};

const entregadorDelete = async (req, res) => {
  try {
    const entregador = await Entregador.findById(req.params.id);
    if (!entregador) return res.status(404).json({ error: "Motorista nao encontrado." });
    if (!sameRestaurant(req, entregador)) {
      return res.status(403).json({ error: "Motorista pertence a outro restaurante." });
    }
    await Entregador.findByIdAndDelete(req.params.id);
    return res.json({ message: "Motorista excluido com sucesso." });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao excluir motorista." });
  }
};

const token = async (req, res) => {
  try {
    const entregadorId = idString(req.entregadorId || req.userId);
    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    await Entregador.findByIdAndUpdate(entregadorId, { expoPushToken });
    return res.json({ sucesso: true });
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao salvar token." });
  }
};

const entregadorTrocaSenha = async (req, res) => {
  try {
    const entregador = await Entregador.findById(req.params.id);
    if (!entregador) return res.status(404).json({ error: "Motorista nao encontrado." });
    if (!sameRestaurant(req, entregador)) {
      return res.status(403).json({ error: "Motorista pertence a outro restaurante." });
    }
    if (!req.body?.novaSenha || String(req.body.novaSenha).length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter ao menos 6 caracteres." });
    }
    await Entregador.findByIdAndUpdate(req.params.id, {
      senha: await bcrypt.hash(req.body.novaSenha, 10),
    });
    return res.json({ message: "Senha atualizada com sucesso." });
  } catch (error) {
    return res.status(500).json({ error: "Erro ao atualizar senha." });
  }
};

const login = async (req, res) => {
  const { email, senha, latitude, longitude } = req.body;
  try {
    const entregador = await Entregador.findOne({ email: String(email || "").trim().toLowerCase() });
    if (!entregador) return res.status(400).json({ error: "Usuario nao encontrado." });
    if (
      String(entregador.statusConta || "ativo").toLowerCase() === "bloqueado"
    ) {
      return res.status(403).json({ error: "Acesso bloqueado pelo restaurante." });
    }
    if (!(await bcrypt.compare(String(senha || ""), entregador.senha))) {
      return res.status(400).json({ error: "Senha incorreta." });
    }

    const restaurante = await Restaurante.findById(entregador.restaurante).lean();
    if (!restaurante || restaurante.ativo === false) {
      return res.status(403).json({ error: "Restaurante bloqueado ou inativo." });
    }
    if (!planHasFeature(restaurante, "driversApp")) {
      return res.status(403).json({ error: "O app Movyo Motorista esta disponivel no plano Premium." });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const distancia = await calcularDistanciaEntrega(lat, lng, restaurante.localizacao || {});
      if (distancia === null) {
        return res.status(400).json({ error: "Localizacao invalida para calcular distancia." });
      }
      entregador.localizacao = { latitude: lat, longitude: lng };
      await entregador.save();
    }

    const token = jwt.sign(
      {
        id: idString(entregador),
        entregadorId: idString(entregador),
        restauranteId: idString(entregador.restaurante),
        role: "entregador",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    return res.json({ token, entregador: sanitize(entregador) });
  } catch (error) {
    return res.status(500).json({ error: "Erro no login.", details: error.message });
  }
};

const atualizarStatus = async (req, res) => {
  try {
    const entregadorId = idString(req.entregadorId || req.userId);
    const online = req.body?.online === true || String(req.body?.status || "").toLowerCase() === "online";
    const entregador = await Entregador.findByIdAndUpdate(
      entregadorId,
      { status: online, disponivel: online },
      { new: true }
    );
    return res.json({ message: "Status atualizado.", entregador: sanitize(entregador) });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao atualizar status." });
  }
};

const atualizarLocalizacao = async (req, res, io) => {
  try {
    const entregadorId = idString(req.entregadorId || req.userId);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "Localizacao invalida." });
    }
    const entregador = await Entregador.findByIdAndUpdate(
      entregadorId,
      { localizacao: { latitude, longitude }, ultimaLocalizacaoEm: new Date() },
      { new: true }
    );
    io?.to(`restaurante-${idString(entregador.restaurante)}`).emit("localizacaoAtualizada", {
      entregadorId,
      email: entregador.email,
      latitude,
      longitude,
    });
    return res.json({ message: "Localizacao atualizada.", entregador: sanitize(entregador) });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao atualizar localizacao." });
  }
};

const listarDisponiveis = async (req, res) => {
  try {
    const restauranteId = idString(req.restauranteId || req.params.restauranteId);
    const entregadores = await Entregador.find({ restaurante: restauranteId, disponivel: true });
    return res.json(entregadores.map(sanitize));
  } catch (error) {
    return res.status(500).json({ message: "Erro ao buscar motoristas." });
  }
};

const atualizarEntregador = async (req, res) => {
  try {
    const entregador = await Entregador.findById(req.params._id);
    if (!entregador) return res.status(404).json({ message: "Motorista nao encontrado." });
    if (!sameRestaurant(req, entregador)) {
      return res.status(403).json({ message: "Motorista pertence a outro restaurante." });
    }

    const dados = {};
    ["nome", "email", "cpf", "statusConta", "expoPushToken"].forEach((key) => {
      if (req.body?.[key] !== undefined && req.body[key] !== "") dados[key] = req.body[key];
    });
    if (req.body?.statusConta) {
      const ativo = String(req.body.statusConta).toLowerCase() !== "bloqueado";
      dados.status = ativo ? entregador.status : false;
      dados.disponivel = ativo ? entregador.disponivel : false;
    }
    if (req.body?.senha) dados.senha = await bcrypt.hash(req.body.senha, 10);

    const atualizado = await Entregador.findByIdAndUpdate(req.params._id, dados, { new: true });
    return res.json({ message: "Motorista atualizado com sucesso.", entregador: sanitize(atualizado) });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao atualizar motorista.", error: error.message });
  }
};

const listarEntregadores = async (req, res) => {
  try {
    const restauranteId = idString(req.restauranteId || req.params.restauranteId);
    const entregadores = await Entregador.find({ restaurante: restauranteId });
    return res.json(entregadores.map(sanitize));
  } catch (error) {
    return res.status(500).json({ message: "Erro ao buscar motoristas." });
  }
};

module.exports = {
  register,
  login,
  atualizarLocalizacao,
  listarDisponiveis,
  atualizarEntregador,
  listarEntregadores,
  entregadorDelete,
  entregadorTrocaSenha,
  atualizarStatus,
  token,
};