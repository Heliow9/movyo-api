const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Entregador = require('../models/Entregador');
const Restaurante = require('../models/Restaurante');
const { calcularDistanciaEntrega, geocodificarEndereco, metrosParaKm, normalizarCoordenadas } = require('../services/distanciaService');
const { io } = require("../index.js"); // ou o caminho correto para onde você exportou o `io`

const montarEnderecoRestaurante = (restaurante = {}) => {
  return [
    restaurante.enderecoRua,
    restaurante.enderecoNumero,
    restaurante.enderecoBairro,
    restaurante.enderecoCidade,
    restaurante.enderecoEstado,
    restaurante.enderecoCep,
    "Brasil",
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
};

const obterLocalizacaoLoja = async (restaurante) => {
  const cadastrada = normalizarCoordenadas(restaurante?.localizacao || {});
  if (cadastrada) return { coords: cadastrada, fonte: "cadastro" };

  const endereco = montarEnderecoRestaurante(restaurante);
  if (!endereco) return { coords: null, fonte: "ausente" };

  const geocodificada = await geocodificarEndereco(endereco);
  const restauranteId = restaurante?._id || restaurante?.id;
  if (geocodificada && restauranteId) {
    Restaurante.findByIdAndUpdate(restauranteId, { localizacao: geocodificada }).catch((err) => {
      console.warn("Nao foi possivel salvar localizacao geocodificada da loja:", err?.message || err);
    });
    return { coords: geocodificada, fonte: "geocodificada" };
  }

  return { coords: null, fonte: "nao_encontrada" };
};

const montarPayloadDistancia = (distanciaMetros, localizacaoLojaInfo) => {
  if (!Number.isFinite(Number(distanciaMetros))) {
    return {
      distancia: null,
      distanciaKm: null,
      distanciaMetros: null,
      unidade: "km",
      localizacaoLojaConfigurada: Boolean(localizacaoLojaInfo?.coords),
      localizacaoLojaFonte: localizacaoLojaInfo?.fonte || "ausente",
    };
  }

  const metros = Number(distanciaMetros);
  const km = metrosParaKm(metros);
  return {
    distancia: km,
    distanciaKm: km,
    distanciaMetros: Number(metros.toFixed(2)),
    unidade: "km",
    localizacaoLojaConfigurada: Boolean(localizacaoLojaInfo?.coords),
    localizacaoLojaFonte: localizacaoLojaInfo?.fonte || "cadastro",
  };
};


const register = async (req, res) => {
  const { nome, email, senha, cpf, restauranteId } = req.body;

  try {
    const entregadorExistente = await Entregador.findOne({ email });
    if (entregadorExistente) {
      return res.status(400).json({
        error: 'Este e-mail já está vinculado a outro restaurante. Utilize um e-mail diferente para este entregador.'
      });
    }

    const cpfExistente = await Entregador.findOne({ cpf });
    if (cpfExistente) {
      return res.status(400).json({
        error: 'Este CPF já está vinculado a outro entregador.'
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const novoEntregador = await Entregador.create({
      nome,
      email,
      senha: senhaHash,
      restaurante: restauranteId,
      cpf,
      statusConta: 'ativo',
      status: true,
      disponivel: true
    });

    res.status(201).json({ message: 'Entregador cadastrado com sucesso', entregador: novoEntregador });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar entregador', details: error.message });
  }
};


const entregadorDelete = async (req, res) => {

  try {
    await Entregador.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Entregador excluído com sucesso" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao excluir entregador" });
  }

};


const token = async (req, res) => {
  const { entregadorId, expoPushToken } = req.body;
  try {
    console.log("🛡️ Salvando token para entregador:", entregadorId, expoPushToken);  // 👈
    await Entregador.findByIdAndUpdate(entregadorId, { expoPushToken });
    res.status(200).json({ sucesso: true });
  } catch (err) {
    console.error("❌ Erro ao salvar token:", err.message);
    res.status(500).json({ erro: "Erro ao salvar token" });
  }

};

const entregadorTrocaSenha = async (req, res) => {

  const { novaSenha } = req.body;

  try {
    const hashedSenha = await bcrypt.hash(novaSenha, 10); // Se usar bcrypt
    await Entregador.findByIdAndUpdate(req.params.id, { senha: hashedSenha });
    res.status(200).json({ message: 'Senha atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar senha' });
  }

};





const login = async (req, res) => {
  const { email, senha, latitude, longitude } = req.body;
  console.log(req.body)
  try {
    const entregador = await Entregador.findOne({ email });
    if (!entregador) return res.status(400).json({ error: 'Usuário não encontrado.' });

    const bloqueado = String(entregador.statusConta || 'ativo').toLowerCase() === 'bloqueado' || entregador.status === false;
    if (bloqueado) return res.status(403).json({ error: 'Acesso bloqueado pelo restaurante.' });

    const senhaCorreta = await bcrypt.compare(senha, entregador.senha);
    if (!senhaCorreta) return res.status(400).json({ error: 'Senha incorreta.' });

    const restauranteId = entregador.restaurante || entregador.restauranteId;
    const restaurante = restauranteId
      ? await Restaurante.findById(restauranteId).lean().catch(() => null)
      : null;

    const localizacaoMotorista = normalizarCoordenadas({ latitude, longitude });
    if (!localizacaoMotorista) {
      return res.status(400).json({ error: 'Localizacao do motorista invalida.' });
    }

    const localizacaoLojaInfo = await obterLocalizacaoLoja(restaurante);
    const distancia = localizacaoLojaInfo.coords
      ? await calcularDistanciaEntrega(
          localizacaoMotorista.latitude,
          localizacaoMotorista.longitude,
          localizacaoLojaInfo.coords
        )
      : null;
    const distanciaInfo = montarPayloadDistancia(distancia, localizacaoLojaInfo);
    // comentado apenas para fins de teste aw função esta funcionando corretamente!
    // if (distanciaInfo.distanciaMetros > 500) return res.status(403).json({ error: 'Você precisa estar a até 500m da loja para fazer login.' });

    const horaAtual = new Date();
    const horaBrasilia = horaAtual.getUTCHours() - 3;
    const horaAjustada = (horaBrasilia + 24) % 24;

    // // Se for entre 12:00 e 17:59, bloqueia
    // if (horaAjustada >= 16 && horaAjustada < 18) {
    //   return res.status(403).json({ error: `Login permitido apenas entre 18:00 e 11:00. Hora atual: ${horaAjustada}` });
    // }

    entregador.localizacao = { latitude: localizacaoMotorista.latitude, longitude: localizacaoMotorista.longitude };
    await entregador.save();

    const token = jwt.sign({ id: entregador._id, restauranteId: entregador.restaurante || entregador.restauranteId }, process.env.JWT_SECRET, {
      expiresIn: '1d'
    });

    res.json({ token, entregador, ...distanciaInfo });
   
  } catch (error) {
    res.status(500).json({ error: 'Erro no login.', details: error.message });
  }
};


const atualizarStatus = async (req, res) => {
  const { email, status } = req.body;

  try {
    const entregador = await Entregador.findOneAndUpdate(
      { email },
      { status: status === 'online' },
      { new: true }
    );

    if (!entregador) {
      return res.status(404).json({ message: 'Entregador não encontrado' });
    }

    res.json({ message: 'Status atualizado', entregador });
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ message: 'Erro interno' });
  }
};





const atualizarLocalizacao = async (req, res, io) => {
  const { email, latitude, longitude, restauranteId } = req.body;

  try {
    const localizacaoMotorista = normalizarCoordenadas({ latitude, longitude });
    if (!email || !localizacaoMotorista) {
      return res.status(400).json({ message: "Email ou localizacao do motorista invalida." });
    }

    const restaurante = restauranteId
      ? await Restaurante.findById(restauranteId).lean().catch(() => null)
      : null;

    const localizacaoLojaInfo = await obterLocalizacaoLoja(restaurante);
    const distancia = localizacaoLojaInfo.coords
      ? await calcularDistanciaEntrega(
          localizacaoMotorista.latitude,
          localizacaoMotorista.longitude,
          localizacaoLojaInfo.coords
        )
      : null;
    const distanciaInfo = montarPayloadDistancia(distancia, localizacaoLojaInfo);

    const entregador = await Entregador.findOneAndUpdate(
      { email },
      { localizacao: localizacaoMotorista },
      { new: true }
    );

    if (!entregador) {
      return res.status(404).json({ message: "Entregador não encontrado." });
    }

    const restauranteDoEntregador = restauranteId || entregador.restaurante || entregador.restauranteId;
    const payloadSocket = {
      id: String(entregador._id || entregador.id),
      _id: String(entregador._id || entregador.id),
      entregadorId: String(entregador._id || entregador.id),
      nome: entregador.nome,
      email: entregador.email,
      restauranteId: String(restauranteDoEntregador || ""),
      latitude: localizacaoMotorista.latitude,
      longitude: localizacaoMotorista.longitude,
      localizacao: localizacaoMotorista,
      atualizadoEm: new Date().toISOString(),
      ...distanciaInfo,
    };

    console.log(`➡️ Emitindo localização para sala restaurante-${restauranteDoEntregador}:`, payloadSocket);

    if (restauranteDoEntregador) {
      io.to(`restaurante-${restauranteDoEntregador}`).emit("localizacaoAtualizada", payloadSocket);
      io.to(`restaurante-${restauranteDoEntregador}`).emit("delivererLocationUpdated", payloadSocket);
    }

    res.json({
      message: "Localização atualizada com sucesso.",
      ...distanciaInfo,
      entregador,
      restauranteId: restauranteDoEntregador
    });
  } catch (error) {
    res.status(500).json({
      message: "Erro ao atualizar localização.",
      error: error.message
    });
  }
};

// Listar entregadores disponíveis de um restaurante
const listarDisponiveis = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const entregadores = await Entregador.find({
      restauranteId,
      disponivel: true,
    });

    res.json(entregadores);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar entregadores", error: error.message });
  }
};

const atualizarEntregador = async (req, res) => {
  const { _id } = req.params;
  const { nome, email, senha, cpf, statusConta, expoPushToken } = req.body;

  try {
    const dadosAtualizados = {};

    if (nome) dadosAtualizados.nome = nome;
    if (email) dadosAtualizados.email = email;
    if (cpf) dadosAtualizados.cpf = cpf;
    if (statusConta) {
      dadosAtualizados.statusConta = statusConta;
      dadosAtualizados.status = String(statusConta).toLowerCase() !== 'bloqueado';
    }
    if (expoPushToken) dadosAtualizados.expoPushToken = expoPushToken;
    if (senha) {
      const senhaHash = await bcrypt.hash(senha, 10);
      dadosAtualizados.senha = senhaHash;
    }

    const entregadorAtualizado = await Entregador.findByIdAndUpdate(
      _id,
      dadosAtualizados,
      { new: true }
    );

    if (!entregadorAtualizado) {
      return res.status(404).json({ message: 'Entregador não encontrado.' });
    }

    res.json({ message: 'Entregador atualizado com sucesso.', entregador: entregadorAtualizado });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar entregador.', error: error.message });
  }
};

const listarEntregadores = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const entregadores = await Entregador.find({ restaurante: restauranteId });
    res.status(200).json(entregadores);
  } catch (error) {
    console.error("Erro ao buscar entregadores por restaurante:", error);
    res.status(500).json({ message: "Erro no servidor" });
  }
}


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
  token
};
