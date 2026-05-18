// controllers/garcomController.js
const Restaurante = require("../models/Restaurante");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const DEFAULT_PERMISSOES = {
  verPedidos: true,
  abrirMesa: true,
  fecharConta: false,
  cancelarPedido: false,
  // adicione aqui as chaves que existem na sua UI
};

const normalizarTel = (tel) => (tel ? String(tel).replace(/\D/g, "") : null);

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
  const obj = garcomDoc.toObject ? garcomDoc.toObject() : garcomDoc;
  // eslint-disable-next-line no-unused-vars
  const { pinHash, ...safe } = obj;
  return safe;
};

exports.listarGarcons = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não autenticado." });
    }

    const doc = await Restaurante.findById(restauranteId).select("garcons");
    if (!doc) return res.status(404).json({ message: "Restaurante não encontrado." });

    return res.json(doc.garcons || []);
  } catch (err) {
    return res.status(500).json({ message: "Erro ao listar garçons.", error: err.message });
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

    if (!Array.isArray(restaurante.garcons)) {
      restaurante.garcons = [];
    }

    const telNorm = normalizarTel(telefone);
    if (!telNorm) {
      return res.status(400).json({ message: "Telefone é obrigatório." });
    }

    const jaExiste = restaurante.garcons.some((g) => g.telefone === telNorm);
    if (jaExiste) {
      return res.status(409).json({ message: "Já existe um garçom com esse telefone." });
    }

    const pinHash = await bcrypt.hash(String(pin), 10);

    restaurante.garcons.push({
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

    await restaurante.save();

    const novo = restaurante.garcons[restaurante.garcons.length - 1];
    const obj = novo.toObject();
    // eslint-disable-next-line no-unused-vars
    const { pinHash: _, ...safe } = obj;

    return res.status(201).json(safe);
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

    const garcom = restaurante.garcons.id(garcomId);
    if (!garcom) return res.status(404).json({ message: "Garçom não encontrado." });

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
    await restaurante.save();

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

    const garcom = restaurante.garcons.id(garcomId);
    if (!garcom) return res.status(404).json({ message: "Garçom não encontrado." });

    garcom.deleteOne();
    await restaurante.save();

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

    const garcom = restaurante.garcons.id(garcomId);
    if (!garcom) return res.status(404).json({ message: "Garçom não encontrado." });

    garcom.ativo = !garcom.ativo;
    garcom.atualizadoEm = new Date();

    await restaurante.save();

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
      "nome slugIdentificador garcons ativo bloqueado mercadoPago.conectado";

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

    // (Opcional) trava restaurante desativado/bloqueado
    if (restaurante?.ativo === false || restaurante?.bloqueado === true) {
      return res.status(403).json({
        message: "Restaurante desativado/bloqueado. Fale com o suporte.",
        code: "RESTAURANTE_BLOQUEADO",
      });
    }

    const garcom = (restaurante.garcons || []).find((g) => g.telefone === telFinal);
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

    const token = jwt.sign(
      {
        role: "garcom",
        restauranteId: String(restaurante._id),
        restauranteSlug: restaurante.slugIdentificador,
        garcomId: String(garcom._id),
        permissoes: garcom.permissoes || {},
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
      },
      restaurante: {
        _id: String(restauranteId),
        nome: garcom.restauranteNome || null,
        // se você quiser enviar slug aqui, pode usar req.restauranteSlug
        slugIdentificador: req.restauranteSlug || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao carregar perfil do garçom",
      error: error?.message,
    });
  }
};

