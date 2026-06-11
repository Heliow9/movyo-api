// controllers/produtoController.js
const Produto = require("../models/Produto");
const CategoriaProduto = require("../models/CategoriaProduto");
const { queryWithRetry } = require("../lib/mysqlRetry");

/** =========================
 * Helpers
 * ========================= */
function toBool(v, fallback = undefined) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;

  const s = String(v).trim().toLowerCase();
  if (["true", "1", "sim", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "nao", "não", "no", "n", "off"].includes(s)) return false;

  return fallback;
}

function normalizeProdutoBody(body = {}, { partial = false } = {}) {
  // ✅ aceita:
  // - imprimeNaCozinha (novo)
  // - imprimirNaCozinha (alias)
  // - kitchenPrint (alias)
  const raw =
    body?.imprimeNaCozinha ??
    body?.imprimirNaCozinha ??
    body?.kitchenPrint;

  // Em CREATE: default = true (se não vier nada, deixa o schema decidir ou força true)
  // Em UPDATE/PATCH: se não vier, não mexe.
  const imprimeNaCozinha = toBool(raw, partial ? undefined : true);

  const normalized = { ...body };

  // remove aliases pra não ficar lixo no doc
  delete normalized.imprimirNaCozinha;
  delete normalized.kitchenPrint;

  if (imprimeNaCozinha !== undefined) normalized.imprimeNaCozinha = imprimeNaCozinha;

  const rawDestaque = normalized.destaque ?? normalized.emDestaque ?? normalized.isDestaque;
  if (rawDestaque !== undefined) {
    normalized.destaque = toBool(rawDestaque, false);
  }
  delete normalized.emDestaque;
  delete normalized.isDestaque;

  // ✅ Produto ativo na vitrine/cardápio público.
  // Produtos antigos devem ser tratados como true; novos podem vir true/false pelo switch.
  const rawAtivoVitrine = normalized.ativoVitrine ?? normalized.vitrineAtiva ?? normalized.ativoNaVitrine;
  const ativoVitrine = toBool(rawAtivoVitrine, partial ? undefined : true);
  if (ativoVitrine !== undefined) normalized.ativoVitrine = ativoVitrine;
  delete normalized.vitrineAtiva;
  delete normalized.ativoNaVitrine;

  const rawPreco = normalized.precoBase ?? normalized.preco;
  if (rawPreco !== undefined && rawPreco !== null && rawPreco !== '') {
    const precoNumber = Number(String(rawPreco).replace(',', '.'));
    normalized.preco = Number.isFinite(precoNumber) ? precoNumber : 0;
    normalized.precoBase = normalized.preco;
  }

  return normalized;
}


function normalizeProdutoResponse(produto) {
  if (!produto) return produto;
  const plain = typeof produto.toObject === "function" ? produto.toObject() : { ...produto };
  const preco = Number(plain.preco ?? plain.precoBase ?? 0);
  plain.preco = Number.isFinite(preco) ? preco : 0;
  plain.precoBase = Number.isFinite(preco) ? preco : 0;
  // ✅ compatibilidade: produtos já cadastrados antes desse campo entram como ativos na vitrine.
  if (plain.ativoVitrine === undefined || plain.ativoVitrine === null) plain.ativoVitrine = true;
  return plain;
}

function normalizeProdutoListResponse(list) {
  return Array.isArray(list) ? list.map(normalizeProdutoResponse) : [];
}


function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function boolFromDb(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "sim", "yes"].includes(String(value).toLowerCase());
}

/** =========================
 * Criar produto
 * ========================= */
const criarProduto = async (req, res) => {
  try {
    const payload = normalizeProdutoBody(req.body, { partial: false });
    const novoProduto = await Produto.create(payload);
    res.status(201).json(normalizeProdutoResponse(novoProduto));
  } catch (err) {
    console.error("Erro ao criar produto:", err);
    res.status(500).json({ erro: "Erro ao criar produto." });
  }
};

/** =========================
 * Editar produto
 * ========================= */
const editarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const payload = normalizeProdutoBody(req.body, { partial: true });

    const atualizado = await Produto.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!atualizado) return res.status(404).json({ erro: "Produto não encontrado." });
    res.json(normalizeProdutoResponse(atualizado));
  } catch (err) {
    console.error("Erro ao editar produto:", err);
    res.status(500).json({ erro: "Erro ao editar produto." });
  }
};

/** =========================
 * Buscar produtos por restaurante
 * ========================= */
const getProdutosPorRestaurante = async (req, res) => {
  const { restauranteId } = req.params;
  try {
    if (!restauranteId) return res.status(400).json({ erro: "restauranteId é obrigatório." });

    // Performance/estabilidade: uma única consulta com JOIN e retry contra ECONNRESET.
    const [rows] = await queryWithRetry(
      `SELECT p.*, c.id AS categoriaJoinId, c.nome AS categoriaJoinNome, c.ordem AS categoriaJoinOrdem,
              c.ativa AS categoriaJoinAtiva, c.permiteSabores AS categoriaJoinPermiteSabores,
              c.pizzaMultisabor AS categoriaJoinPizzaMultisabor, c.calculoPrecoPor AS categoriaJoinCalculoPrecoPor,
              c.maxSabores AS categoriaJoinMaxSabores, c.tiposExtras AS categoriaJoinTiposExtras,
              c.saboresDisponiveis AS categoriaJoinSaboresDisponiveis,
              c.bordasDisponiveis AS categoriaJoinBordasDisponiveis,
              c.adicionaisDisponiveis AS categoriaJoinAdicionaisDisponiveis,
              c.complementosDisponiveis AS categoriaJoinComplementosDisponiveis
         FROM produtos p
    LEFT JOIN categorias_produto c ON c.id = p.categoria
        WHERE p.restaurante = ?
        ORDER BY COALESCE(p.ordem, 0), p.nome`,
      [String(restauranteId)],
      { label: "produtos.porRestaurante" }
    );

    const vistos = new Set();
    const produtosNormalizados = (rows || []).filter((row) => {
      const id = String(row?.id || row?._id || "");
      if (!id) return true;
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    }).map((row) => {
      const categoriaId = String(row.categoria || row.categoriaJoinId || "");
      const produto = normalizeProdutoResponse({
        ...row,
        _id: row.id,
        id: row.id,
        extras: parseJsonSafe(row.extras, []),
        estoque: parseJsonSafe(row.estoque, {}),
        sabores: parseJsonSafe(row.sabores, []),
        bordas: parseJsonSafe(row.bordas, []),
        adicionais: parseJsonSafe(row.adicionais, []),
        complementos: parseJsonSafe(row.complementos, []),
      });

      const categoriaExiste = !!row.categoriaJoinId;
      return {
        ...produto,
        ativo: boolFromDb(row.ativo, true),
        ativoVitrine: boolFromDb(row.ativoVitrine, true),
        disponivel: boolFromDb(row.disponivel, true),
        destaque: boolFromDb(row.destaque, false),
        imprimeNaCozinha: boolFromDb(row.imprimeNaCozinha, true),
        categoria: categoriaExiste ? {
          _id: row.categoriaJoinId,
          id: row.categoriaJoinId,
          nome: row.categoriaJoinNome || "Sem categoria",
          ordem: Number(row.categoriaJoinOrdem || 0),
          ativa: boolFromDb(row.categoriaJoinAtiva, true),
          permiteSabores: boolFromDb(row.categoriaJoinPermiteSabores, false),
          pizzaMultisabor: boolFromDb(row.categoriaJoinPizzaMultisabor, false),
          calculoPrecoPor: row.categoriaJoinCalculoPrecoPor || "maior",
          maxSabores: Number(row.categoriaJoinMaxSabores || 1),
          tiposExtras: parseJsonSafe(row.categoriaJoinTiposExtras, []),
          saboresDisponiveis: parseJsonSafe(row.categoriaJoinSaboresDisponiveis, []),
          bordasDisponiveis: parseJsonSafe(row.categoriaJoinBordasDisponiveis, []),
          adicionaisDisponiveis: parseJsonSafe(row.categoriaJoinAdicionaisDisponiveis, []),
          complementosDisponiveis: parseJsonSafe(row.categoriaJoinComplementosDisponiveis, []),
        } : (categoriaId || null),
        categoriaId: categoriaId || null,
        categoriaNome: categoriaExiste ? (row.categoriaJoinNome || "Sem categoria") : "Sem categoria",
      };
    });

    res.json(produtosNormalizados);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ erro: "Erro ao buscar produtos.", code: err.code, message: err.message });
  }
};

/** =========================
 * Reordenar produtos
 * ========================= */
const reordenarProdutos = async (req, res) => {
  const { produtos } = req.body;

  if (!Array.isArray(produtos)) {
    return res.status(400).json({ erro: "Lista de produtos inválida." });
  }

  try {
    for (const { _id, ordem } of produtos) {
      await Produto.findByIdAndUpdate(_id, { ordem }, { runValidators: true });
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro ao reordenar produtos:", err);
    res.status(500).json({ erro: "Erro ao reordenar produtos." });
  }
};

/** =========================
 * Ativar / Desativar
 * ========================= */
const ativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    await Produto.findByIdAndUpdate(id, { ativo: true }, { runValidators: true });
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro ao ativar produto:", err);
    res.status(500).json({ erro: "Erro ao ativar produto." });
  }
};

const desativarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    await Produto.findByIdAndUpdate(id, { ativo: false }, { runValidators: true });
    res.sendStatus(200);
  } catch (err) {
    console.error("Erro ao desativar produto:", err);
    res.status(500).json({ erro: "Erro ao desativar produto." });
  }
};

/** =========================
 * Excluir
 * ========================= */
const excluirProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const deletado = await Produto.findByIdAndDelete(id);
    if (!deletado) return res.status(404).json({ erro: "Produto não encontrado." });
    res.json({ mensagem: "Produto excluído com sucesso." });
  } catch (err) {
    console.error("Erro ao excluir produto:", err);
    res.status(500).json({ erro: "Erro ao excluir produto." });
  }
};

/** =========================
 * Duplicar produto
 * ========================= */
const duplicarProduto = async (req, res) => {
  const { id } = req.params;
  try {
    const produtoOriginal = await Produto.findById(id).lean();
    if (!produtoOriginal) {
      return res.status(404).json({ erro: "Produto original não encontrado." });
    }

    // Pega todos os produtos da mesma categoria e restaurante, ordenados
    const outrosProdutos = await Produto.find({
      restaurante: produtoOriginal.restaurante,
      categoria: produtoOriginal.categoria,
    }).sort({ ordem: 1 });

    const indexOriginal = outrosProdutos.findIndex((p) => p._id.toString() === id);
    const novaOrdem = indexOriginal + 1;

    // Atualiza a ordem dos que vêm depois
    for (let i = outrosProdutos.length - 1; i > indexOriginal; i--) {
      await Produto.findByIdAndUpdate(outrosProdutos[i]._id, { ordem: i + 1 }, { runValidators: true });
    }

    // Monta o clone com ordem nova
    const copia = {
      ...produtoOriginal,
      nome: `${produtoOriginal.nome} (cópia)`,
      ordem: novaOrdem,
      _id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    };

    // ✅ garante que o campo novo exista na cópia (caso doc antigo não tenha)
    if (copia.imprimeNaCozinha === undefined) copia.imprimeNaCozinha = true;
    if (copia.ativoVitrine === undefined) copia.ativoVitrine = true;

    const novoProduto = await Produto.create(copia);
    res.status(201).json(normalizeProdutoResponse(novoProduto));
  } catch (err) {
    console.error("Erro ao duplicar produto:", err);
    res.status(500).json({ erro: "Erro ao duplicar produto." });
  }
};

/** =========================
 * Patch Estoque Opcionais
 * ========================= */
const patchEstoqueOpcionais = async (req, res) => {
  try {
    const { id } = req.params;
    const { estoqueOpcionais } = req.body;

    const produto = await Produto.findById(id);
    if (!produto) return res.status(404).json({ mensagem: "Produto não encontrado." });

    produto.estoqueOpcionais = estoqueOpcionais || {};
    await produto.save();

    return res.json({ data: produto });
  } catch (err) {
    return res.status(500).json({
      mensagem: "Erro ao salvar vínculos de estoque.",
      error: err?.message,
    });
  }
};

/**
 * ✅ Marcar/Desmarcar produto como destaque
 * PUT /api/produtos/:id/destaque
 * Body: { destaque: true/false }
 */
const setProdutoDestaque = async (req, res) => {
  const { id } = req.params;
  const { destaque } = req.body;

  try {
    const produto = await Produto.findById(id);
    if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });

    produto.destaque = destaque === true || destaque === 1 || destaque === '1' || String(destaque).toLowerCase() === 'true';
    await produto.save();

    return res.json({ ok: true, destaque: produto.destaque, data: produto });
  } catch (err) {
    console.error("Erro ao atualizar destaque:", err);
    return res.status(500).json({ erro: "Erro ao atualizar destaque." });
  }
};

/**
 * ✅ NOVO: Marcar/Desmarcar impressão na cozinha
 * PUT /api/produtos/:id/imprime-cozinha
 * Body: { imprimeNaCozinha: true/false }
 */
const setProdutoImprimeCozinha = async (req, res) => {
  const { id } = req.params;

  try {
    const produto = await Produto.findById(id);
    if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });

    const payload = normalizeProdutoBody(req.body, { partial: true });

    if (payload.imprimeNaCozinha === undefined) {
      return res.status(400).json({ erro: "Informe imprimeNaCozinha (true/false)." });
    }

    produto.imprimeNaCozinha = !!payload.imprimeNaCozinha;
    await produto.save();

    return res.json({ ok: true, imprimeNaCozinha: produto.imprimeNaCozinha, data: produto });
  } catch (err) {
    console.error("Erro ao atualizar imprimeNaCozinha:", err);
    return res.status(500).json({ erro: "Erro ao atualizar impressão da cozinha." });
  }
};


/**
 * ✅ Marcar/Desmarcar produto na vitrine/cardápio público
 * PUT /api/produtos/:id/vitrine
 * Body: { ativoVitrine: true/false }
 */
const setProdutoAtivoVitrine = async (req, res) => {
  const { id } = req.params;

  try {
    const produto = await Produto.findById(id);
    if (!produto) return res.status(404).json({ erro: "Produto não encontrado." });

    const ativoVitrine = toBool(
      req.body?.ativoVitrine ?? req.body?.vitrineAtiva ?? req.body?.ativoNaVitrine,
      undefined
    );

    if (ativoVitrine === undefined) {
      return res.status(400).json({ erro: "Informe ativoVitrine (true/false)." });
    }

    produto.ativoVitrine = ativoVitrine;
    await produto.save();

    return res.json({ ok: true, ativoVitrine: produto.ativoVitrine, data: normalizeProdutoResponse(produto) });
  } catch (err) {
    console.error("Erro ao atualizar produto na vitrine:", err);
    return res.status(500).json({ erro: "Erro ao atualizar status na vitrine." });
  }
};

module.exports = {
  criarProduto,
  getProdutosPorRestaurante,
  reordenarProdutos,
  ativarProduto,
  desativarProduto,
  editarProduto,
  excluirProduto,
  duplicarProduto,
  patchEstoqueOpcionais,
  setProdutoDestaque,
  setProdutoImprimeCozinha, // ✅ export novo
  setProdutoAtivoVitrine,
};
