const CategoriaProduto = require('../models/CategoriaProduto');
const Produto = require('../models/Produto');
const { queryWithRetry } = require('../lib/mysqlRetry');


function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function boolFromDb(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['1','true','sim','yes'].includes(String(value).toLowerCase());
}

/**
 * 🔒 Função de blindagem de dados da categoria
 * Garante consistência para pizza / pizza multisabor
 */
function normalizarCategoriaPayload(payload = {}) {
  const body = { ...payload };

  // 🍕 Se for pizza multisabor, força regras corretas
  if (body.pizzaMultisabor) {
    body.permiteSabores = true;
    body.calculoPrecoPor = body.calculoPrecoPor || "maior";
  }

  // ❌ Nunca permitir "Sabores" como tipo extra
  if (Array.isArray(body.tiposExtras) && (body.permiteSabores || body.pizzaMultisabor)) {
    body.tiposExtras = body.tiposExtras.filter(
      (t) => String(t.nome || "").trim().toLowerCase() !== "sabores"
    );
  }

  // 🧠 Normalização segura dos arrays conforme flags
  body.saboresDisponiveis =
    body.permiteSabores || body.pizzaMultisabor
      ? body.saboresDisponiveis || []
      : [];

  body.bordasDisponiveis = body.permiteBordas
    ? body.bordasDisponiveis || []
    : [];

  body.adicionaisDisponiveis = body.permiteAdicionais
    ? body.adicionaisDisponiveis || []
    : [];

  body.complementosDisponiveis = body.permiteComplementos
    ? body.complementosDisponiveis || []
    : [];

  return body;
}

// =========================
// Criar nova categoria
// =========================
const createCategoria = async (req, res) => {
  try {
    if (!req.body.nome || !req.body.restaurante) {
      return res.status(400).json({
        error: "Nome e restaurante são obrigatórios"
      });
    }

    const payload = normalizarCategoriaPayload(req.body);

    const novaCategoria = await CategoriaProduto.create({
      nome: payload.nome,
      restaurante: payload.restaurante,

      permiteSabores: payload.permiteSabores,
      permiteBordas: payload.permiteBordas,
      permiteAdicionais: payload.permiteAdicionais,
      permiteComplementos: payload.permiteComplementos,

      saboresDisponiveis: payload.saboresDisponiveis,
      bordasDisponiveis: payload.bordasDisponiveis,
      adicionaisDisponiveis: payload.adicionaisDisponiveis,
      complementosDisponiveis: payload.complementosDisponiveis,

      tiposExtras: (payload.tiposExtras || []).map(extra => ({
        nome: extra.nome,
        obrigatorio: extra.obrigatorio || false,
        tipoSelecion: extra.tipoSelecion || "unico",
        maximoSelecionados: extra.maximoSelecionados ?? 1,
        minimoSelecionados: extra.minimoSelecionados ?? 0,
        itens: extra.itens || []
      })),

      pizzaMultisabor: payload.pizzaMultisabor,
      calculoPrecoPor: payload.calculoPrecoPor || "maior"
    });

    res.status(201).json({
      message: "Categoria criada com sucesso",
      categoria: novaCategoria
    });
  } catch (err) {
    console.error("Erro ao criar categoria:", err);
    res.status(500).json({
      error: "Erro ao criar categoria",
      details: err.message
    });
  }
};

// =========================
// Listar categorias por restaurante
// =========================
const listarCategoriasPorRestaurante = async (req, res) => {
  try {
    const restauranteId = req.params.restauranteId;
    if (!restauranteId) return res.status(400).json({ error: 'restauranteId é obrigatório' });

    const [rows] = await queryWithRetry(
      `SELECT * FROM categorias_produto WHERE restaurante = ? ORDER BY COALESCE(ordem, 0), nome`,
      [String(restauranteId)],
      { label: 'categorias.porRestaurante' }
    );

    const categorias = (rows || []).map((c) => ({
      ...c,
      _id: c.id,
      id: c.id,
      ativa: boolFromDb(c.ativa, true),
      permiteSabores: boolFromDb(c.permiteSabores, false),
      permiteBordas: boolFromDb(c.permiteBordas, false),
      permiteAdicionais: boolFromDb(c.permiteAdicionais, false),
      permiteComplementos: boolFromDb(c.permiteComplementos, false),
      pizzaMultisabor: boolFromDb(c.pizzaMultisabor, false),
      tiposExtras: parseJsonSafe(c.tiposExtras, []),
      saboresDisponiveis: parseJsonSafe(c.saboresDisponiveis, []),
      bordasDisponiveis: parseJsonSafe(c.bordasDisponiveis, []),
      adicionaisDisponiveis: parseJsonSafe(c.adicionaisDisponiveis, []),
      complementosDisponiveis: parseJsonSafe(c.complementosDisponiveis, []),
      maxSabores: Number(c.maxSabores || 1),
      ordem: Number(c.ordem || 0),
    }));

    res.status(200).json(categorias);
  } catch (err) {
    res.status(500).json({
      error: "Erro ao listar categorias",
      details: err.message,
      code: err.code,
    });
  }
};

// =========================
// Atualizar categoria
// =========================
const atualizarCategoria = async (req, res) => {
  try {
    const payload = normalizarCategoriaPayload(req.body);

    const categoriaAtualizada = await CategoriaProduto.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true }
    );

    if (!categoriaAtualizada) {
      return res.status(404).json({ error: "Categoria não encontrada" });
    }

    res.json({
      message: "Categoria atualizada",
      categoria: categoriaAtualizada
    });
  } catch (err) {
    res.status(500).json({
      error: "Erro ao atualizar categoria",
      details: err.message
    });
  }
};

// =========================
// Atualizar ordem das categorias
// =========================
const atualizarOrdemCategorias = async (req, res) => {
  try {
    const { categorias } = req.body;

    if (!Array.isArray(categorias)) {
      return res.status(400).json({ error: "Formato inválido" });
    }

    // Compatível com Mongo/Mongoose e com o mysqlModelFactory do projeto.
    // bulkWrite não existe em todos os adapters, por isso atualizamos item a item.
    await Promise.all(
      categorias.map((cat, idx) =>
        CategoriaProduto.findByIdAndUpdate(cat._id || cat.id, {
          ordem: Number.isFinite(Number(cat.ordem)) ? Number(cat.ordem) : idx,
        })
      )
    );

    res.status(200).json({ message: "Ordem atualizada com sucesso" });
  } catch (err) {
    res.status(500).json({
      error: "Erro ao reordenar categorias",
      details: err.message
    });
  }
};

// =========================
// Deletar categoria + produtos
// =========================
const deletarCategoria = async (req, res) => {
  try {
    await Produto.deleteMany({ categoria: req.params.id });
    await CategoriaProduto.findByIdAndDelete(req.params.id);

    res.json({
      message: "Categoria e produtos vinculados excluídos com sucesso"
    });
  } catch (err) {
    res.status(500).json({
      error: "Erro ao deletar categoria",
      details: err.message
    });
  }
};

// =========================
// Duplicar categoria + produtos
// =========================
const duplicarCategoria = async (req, res) => {
  try {
    const categoriaOriginal = await CategoriaProduto.findById(req.params.id);
    if (!categoriaOriginal) {
      return res.status(404).json({ message: "Categoria não encontrada" });
    }

    const novaCategoria = new CategoriaProduto({
      ...categoriaOriginal.toObject(),
      _id: undefined,
      nome: `${categoriaOriginal.nome} (Cópia)`
    });

    const categoriaSalva = await novaCategoria.save();

    const produtosOriginais = await Produto.find({ categoria: categoriaOriginal._id });

    const produtosDuplicados = produtosOriginais.map(prod => ({
      ...prod.toObject(),
      _id: undefined,
      categoria: categoriaSalva._id,
      nome: `${prod.nome} (Cópia)`
    }));

    await Produto.insertMany(produtosDuplicados);

    res.status(201).json({
      message: "Categoria e produtos duplicados com sucesso"
    });
  } catch (err) {
    console.error("Erro ao duplicar categoria:", err);
    res.status(500).json({
      message: "Erro interno ao duplicar categoria"
    });
  }
};

// =========================
// Ativar / Desativar
// =========================
const ativarCategoria = async (req, res) => {
  try {
    await CategoriaProduto.findByIdAndUpdate(req.params.id, { ativa: true });
    res.status(200).json({ message: "Categoria ativada com sucesso" });
  } catch (err) {
    res.status(500).json({
      error: "Erro ao ativar categoria",
      details: err.message
    });
  }
};

const desativarCategoria = async (req, res) => {
  try {
    await CategoriaProduto.findByIdAndUpdate(req.params.id, { ativa: false });
    res.status(200).json({ message: "Categoria desativada com sucesso" });
  } catch (err) {
    res.status(500).json({
      error: "Erro ao desativar categoria",
      details: err.message
    });
  }
};

module.exports = {
  createCategoria,
  listarCategoriasPorRestaurante,
  atualizarCategoria,
  deletarCategoria,
  atualizarOrdemCategorias,
  duplicarCategoria,
  ativarCategoria,
  desativarCategoria
};
