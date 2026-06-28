// controllers/garcomController.js
const Restaurante = require("../models/Restaurante");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createObjectId } = require("../lib/objectId");
const { queryWithRetry } = require("../lib/mysqlRetry");
const { getPlanSummary } = require("../utils/planRules");

const DEFAULT_PERMISSOES = {
  verPedidos: true,
  verMesas: true,
  verComanda: true,
  abrirMesa: true,
  adicionarItem: true,
  fecharConta: false,
  cancelarPedido: false,
  cancelarSemPinGerente: false,
};

const normalizarTel = (tel) => (tel ? String(tel).replace(/\D/g, "") : null);
const parseJsonSafe = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

const ensureGarconsArray = (restaurante) => {
  if (!Array.isArray(restaurante.garcons)) restaurante.garcons = [];
  restaurante.garcons = restaurante.garcons.map((g) => {
    const obj = g && typeof g.toObject === "function" ? g.toObject() : { ...(g || {}) };
    const id = String(obj._id || obj.id || obj.garcomId || createObjectId());
    return { ...obj, _id: id, id };
  });
  return restaurante.garcons;
};

const findGarcomIndex = (garcons, garcomId) =>
  (Array.isArray(garcons) ? garcons : []).findIndex(
    (g) => String(g?._id || g?.id || g?.garcomId) === String(garcomId)
  );

const persistGarcons = async (restaurante) => {
  ensureGarconsArray(restaurante);
  if (typeof restaurante.save === "function") return restaurante.save();
  return Restaurante.findByIdAndUpdate(restaurante._id || restaurante.id, { garcons: restaurante.garcons }, { new: true });
};

// ✅ Compatível com seu authRestaurante atual (req.userId)
const getRestauranteId = (req) => {
  return (
    req.restauranteId ||
    req.user?.restauranteId ||
    req.restaurante?._id ||
    req.userId // 👈 seu middleware atual
  );
};

const safeGarcom = (garcomDoc) => {
  if (!garcomDoc) return null;
  const obj = garcomDoc.toObject ? garcomDoc.toObject() : { ...garcomDoc };
  const id = String(obj._id || obj.id || obj.garcomId || "");
  // eslint-disable-next-line no-unused-vars
  const { pinHash, ...safe } = { ...obj, _id: id || obj._id, id: id || obj.id };
  return safe;
};

const listarGarconsCache = new Map();
const LISTAR_GARCONS_CACHE_MS = Number(process.env.LISTAR_GARCONS_CACHE_MS || 5000);

exports.listarGarcons = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    const cacheKey = String(restauranteId);
    const cached = listarGarconsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < LISTAR_GARCONS_CACHE_MS) {
      return res.json(cached.data);
    }

    const [rows] = await queryWithRetry(
      `SELECT garcons FROM restaurantes WHERE id = ? LIMIT 1`,
      [String(restauranteId)],
      { label: 'garcons.listar' }
    );
    if (!rows?.length) return res.status(404).json({ message: "Restaurante não encontrado." });

    const data = (parseJsonSafe(rows[0].garcons, []) || []).map(safeGarcom);
    listarGarconsCache.set(cacheKey, { ts: Date.now(), data });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ message: "Erro ao listar garçons.", error: err.message, code: err.code });
  }
};

exports.criarGarcom = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const { nome, apelido, telefone, pin, permissoes } = req.body;

    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    if (!nome?.trim()) {
      return res.status(400).json({ message: "Nome é obrigatório." });
    }

    // ✅ PIN obrigatório
    if (!pin) {
      return res.status(400).json({ message: "PIN é obrigatório para o app do garçom." });
    }
    if (String(pin).length < 4) {
      return res.status(400).json({ message: "PIN deve ter pelo menos 4 dígitos." });
    }

    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) {
      return res.status(404).json({ message: "Restaurante não encontrado." });
    }

    ensureGarconsArray(restaurante);

    const telNorm = normalizarTel(telefone);
    if (!telNorm) {
      return res.status(400).json({ message: "Telefone é obrigatório." });
    }

    const jaExiste = restaurante.garcons.some((g) => g.telefone === telNorm);
    if (jaExiste) {
      return res.status(409).json({ message: "Já existe um garçom com esse telefone." });
    }

    const pinHash = await bcrypt.hash(String(pin), 10);

    const novoId = createObjectId();
    restaurante.garcons.push({
      _id: novoId,
      id: novoId,
      nome: nome.trim(),
      apelido: apelido?.trim() || null,
      telefone: telNorm,
      pinHash,
      // ✅ IMPORTANTE: copia o objeto pra não “vazar” referência
      permissoes: permissoes
        ? { ...DEFAULT_PERMISSOES, ...permissoes }
        : { ...DEFAULT_PERMISSOES },
      ativo: true,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    await persistGarcons(restaurante);

    const novo = restaurante.garcons[restaurante.garcons.length - 1];
    return res.status(201).json(safeGarcom(novo));
  } catch (err) {
    console.error("🔥 ERRO criarGarcom:", err);
    return res.status(500).json({
      message: "Erro ao criar garçom.",
      error: err.message,
    });
  }
};

exports.atualizarGarcom = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    const { garcomId } = req.params;
    const { nome, apelido, telefone, pin, ativo, permissoes } = req.body;

    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const garcons = ensureGarconsArray(restaurante);
    const idx = findGarcomIndex(garcons, garcomId);
    if (idx < 0) return res.status(404).json({ message: "Garçom não encontrado." });
    const garcom = garcons[idx];

    if (typeof nome === "string") garcom.nome = nome.trim();
    if (typeof apelido === "string") garcom.apelido = apelido.trim();

    if (typeof telefone !== "undefined") {
      const telNorm = normalizarTel(telefone);
      if (!telNorm) return res.status(400).json({ message: "Telefone inválido." });

      const mudou = telNorm !== garcom.telefone;
      if (mudou) {
        const jaExiste = (restaurante.garcons || []).some(
          (g) => g.telefone === telNorm && String(g._id) !== String(garcomId)
        );
        if (jaExiste) {
          return res.status(409).json({ message: "Já existe um garçom com esse telefone." });
        }
      }

      garcom.telefone = telNorm;
    }

    if (typeof ativo === "boolean") garcom.ativo = ativo;

    if (permissoes && typeof permissoes === "object") {
      const atual = garcom.permissoes?.toObject ? garcom.permissoes.toObject() : garcom.permissoes || {};
      garcom.permissoes = { ...atual, ...permissoes };
    }

    if (typeof pin !== "undefined") {
      if (!pin) return res.status(400).json({ message: "PIN não pode ser vazio." });
      if (String(pin).length < 4) {
        return res.status(400).json({ message: "PIN deve ter pelo menos 4 dígitos." });
      }
      garcom.pinHash = await bcrypt.hash(String(pin), 10);
    }

    garcom.atualizadoEm = new Date();
    garcons[idx] = garcom;
    await persistGarcons(restaurante);

    return res.json(safeGarcom(garcom));
  } catch (err) {
    return res.status(500).json({ message: "Erro ao atualizar garçom.", error: err.message });
  }
};

exports.removerGarcom = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    const { garcomId } = req.params;

    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const garcons = ensureGarconsArray(restaurante);
    const idx = findGarcomIndex(garcons, garcomId);
    if (idx < 0) return res.status(404).json({ message: "Garçom não encontrado." });

    restaurante.garcons = garcons.filter((_, i) => i !== idx);
    await persistGarcons(restaurante);

    return res.json({ ok: true, message: "Garçom removido." });
  } catch (err) {
    return res.status(500).json({ message: "Erro ao remover garçom.", error: err.message });
  }
};

exports.toggleAtivo = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    const { garcomId } = req.params;

    const restaurante = await Restaurante.findById(restauranteId);
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const garcons = ensureGarconsArray(restaurante);
    const idx = findGarcomIndex(garcons, garcomId);
    if (idx < 0) return res.status(404).json({ message: "Garçom não encontrado." });
    const garcom = garcons[idx];

    garcom.ativo = !garcom.ativo;
    garcom.atualizadoEm = new Date();

    garcons[idx] = garcom;
    await persistGarcons(restaurante);

    return res.json(safeGarcom(garcom));
  } catch (err) {
    return res.status(500).json({ message: "Erro ao alterar status.", error: err.message });
  }
};

// ✅ APP DO GARÇOM: LOGIN (rota pública)
// Aceita agora:
// A) { slugIdentificador, telefone, pin } ✅ novo (separado)
// B) { login: "slug@telefone", pin }      ✅ compat
// C) { identificador: "slug@telefone", pin } ✅ compat
// D) fallback antigo: { restauranteId, telefone, pin }
exports.loginGarcom = async (req, res) => {
  try {
    const {
      pin,

      // formatos aceitos
      slugIdentificador,
      slug,
      restauranteSlug,
      telefone,

      login, // slug@telefone
      identificador, // slug@telefone (antigo)
      restauranteId, // fallback antigo
    } = req.body;

    if (!pin) return res.status(400).json({ message: "PIN é obrigatório." });
    if (String(pin).trim().length < 4) {
      return res.status(400).json({ message: "PIN inválido (mín. 4 dígitos)." });
    }

    const normalizarTelLocal = (tel) => (tel ? String(tel).replace(/\D/g, "") : null);

    // ✅ define slug e telefone finais
    let slugFinal = (slugIdentificador || slug || restauranteSlug || "").toString().trim().toLowerCase();
    let telFinal = normalizarTelLocal(telefone);

    // ✅ se veio login/identificador (slug@telefone), parseia
    const loginFinal = login || identificador;
    if ((!slugFinal || !telFinal) && loginFinal) {
      const parts = String(loginFinal).replace(/\s/g, "").split("@");
      if (parts.length !== 2) {
        return res.status(400).json({ message: "Login inválido. Use slug@telefone." });
      }
      slugFinal = String(parts[0] || "").trim().toLowerCase();
      telFinal = normalizarTelLocal(parts[1]);
    }

    if (slugFinal && telFinal && telFinal.length < 8) {
      return res.status(400).json({ message: "Telefone inválido." });
    }

    let restaurante = null;

    // ✅ AQUI ESTAVA O BUG: você não trazia mercadoPago.conectado
    const SELECT_LOGIN =
      "nome slugIdentificador garcons ativo bloqueado plano statusAssinatura dataFimPlano sessaoVersao mercadoPago.conectado";

    // ✅ modo novo principal: slug + telefone
    if (slugFinal && telFinal) {
      restaurante = await Restaurante.findOne({ slugIdentificador: slugFinal }).select(SELECT_LOGIN);
      if (!restaurante) {
        return res.status(404).json({ message: "Restaurante não encontrado." });
      }
    } else {
      // ✅ fallback antigo: restauranteId + telefone
      if (!restauranteId) {
        return res.status(400).json({ message: "restauranteId é obrigatório." });
      }
      if (!telefone) {
        return res.status(400).json({ message: "Telefone é obrigatório." });
      }

      telFinal = normalizarTelLocal(telefone);
      if (!telFinal || telFinal.length < 8) {
        return res.status(400).json({ message: "Telefone inválido." });
      }

      restaurante = await Restaurante.findById(restauranteId).select(SELECT_LOGIN);
      if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });
    }

    // Trava restaurante por motivo correto: bloqueio real separado de licença vencida.
    const hojeLogin = new Date(); hojeLogin.setHours(0,0,0,0);
    const fimPlanoLogin = restaurante?.dataFimPlano ? new Date(restaurante.dataFimPlano) : null;
    const licencaVencidaLogin = fimPlanoLogin && !isNaN(fimPlanoLogin.getTime()) && fimPlanoLogin < hojeLogin;

    if (licencaVencidaLogin) {
      return res.status(403).json({
        message: "Licença vencida. Regularize o plano para continuar usando o Movyo.",
        code: "LICENCA_VENCIDA",
      });
    }

    if (restaurante?.ativo === false || restaurante?.bloqueado === true || String(restaurante?.statusAssinatura || '').toLowerCase() === 'bloqueado') {
      return res.status(403).json({
        message: "Restaurante bloqueado/desativado. Fale com o suporte.",
        code: "RESTAURANTE_BLOQUEADO",
      });
    }

    const garconsLogin = ensureGarconsArray(restaurante);
    const garcomIdx = garconsLogin.findIndex((g) => normalizarTel(g.telefone) === telFinal);
    const garcom = garcomIdx >= 0 ? garconsLogin[garcomIdx] : null;
    if (!garcom) return res.status(404).json({ message: "Garçom não encontrado." });

    // ✅ TRAVA: garçom desativado
    if (garcom.ativo === false) {
      return res.status(403).json({
        message: "Seu acesso foi desativado. Fale com o gerente do restaurante.",
        code: "GARCOM_DESATIVADO",
      });
    }

    if (!garcom.pinHash) {
      return res.status(403).json({
        message: "Garçom sem PIN configurado. Fale com o gerente do restaurante.",
        code: "GARCOM_SEM_PIN",
      });
    }

    const ok = await bcrypt.compare(String(pin).trim(), garcom.pinHash);
    if (!ok) return res.status(401).json({ message: "PIN inválido." });

    // Garante que ids/permissões normalizados fiquem persistidos no JSON MySQL.
    garconsLogin[garcomIdx] = garcom;
    await persistGarcons(restaurante);

    const token = jwt.sign(
      {
        role: "garcom",
        restauranteId: String(restaurante._id),
        restauranteSlug: restaurante.slugIdentificador,
        garcomId: String(garcom._id),
        permissoes: garcom.permissoes || {},
        sessaoVersao: Number(restaurante.sessaoVersao || 1),
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      token,
      restaurante: {
        _id: restaurante._id,
        nome: restaurante.nome,
        slugIdentificador: restaurante.slugIdentificador,
        plano: restaurante.plano || 'free',
        statusAssinatura: restaurante.statusAssinatura || 'ativo',
        dataFimPlano: restaurante.dataFimPlano || null,
        sessaoVersao: Number(restaurante.sessaoVersao || 1),
        planoInfo: getPlanSummary(restaurante),
        mercadoPago: {
          // ✅ AGORA VEM CERTO
          conectado: !!restaurante.mercadoPago?.conectado,
        },
      },
      garcom: safeGarcom(garcom),
    });
  } catch (err) {
    console.error("🔥 loginGarcom:", err);
    return res.status(500).json({
      message: "Erro ao fazer login do garçom.",
      error: err.message,
    });
  }
};

// controllers/garcomAppController.js (exemplo)
exports.meApp = async (req, res) => {
  try {
    // authRestaurante já popula isso no modo garçom:
    // req.garcomDoc (subdoc), req.user (obj limpo), req.restauranteId
    const garcom = req.user; // já vem limpo e consistente
    const restauranteId = req.restauranteId;
    const restaurante = req.restaurante || {};

    if (!restauranteId || !garcom?._id) {
      return res.status(401).json({ message: "Garçom não autenticado." });
    }

    return res.json({
      garcom: {
        _id: garcom._id,
        nome: garcom.nome,
        apelido: garcom.apelido,
        telefone: garcom.telefone,
        ativo: garcom.ativo !== false,
        permissoes: garcom.permissoes || {},
        sessaoVersao: Number(restaurante.sessaoVersao || 1),
      },
      restaurante: {
        _id: String(restauranteId),
        nome: garcom.restauranteNome || null,
        // se você quiser enviar slug aqui, pode usar req.restauranteSlug
        slugIdentificador: req.restauranteSlug || null,
        plano: restaurante.plano || "free",
        statusAssinatura: restaurante.statusAssinatura || "ativo",
        dataFimPlano: restaurante.dataFimPlano || null,
        planoInfo: getPlanSummary(restaurante),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao carregar perfil do garçom",
      error: error?.message,
    });
  }
};
