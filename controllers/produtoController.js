// controllers/produtoController.js
const Produto = require("../models/Produto");
const CategoriaProduto = require("../models/CategoriaProduto");

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
  return plain;
}

function normalizeProdutoListResponse(list) {
  return Array.isArray(list) ? list.map(normalizeProdutoResponse) : [];
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
    // mysqlModelFactory ainda não faz populate real.
    // Por isso buscamos as categorias manualmente para o app garçom/balcão
    // receber categoria.nome em vez do ID da categoria.
    const [produtos, categorias] = await Promise.all([
      Produto.find({ restaurante: restauranteId }),
      CategoriaProduto.find({ restaurante: restauranteId }),
    ]);

    const categoriaMap = new Map(
      (categorias || []).map((cat) => {
        const plain = typeof cat?.toObject === "function" ? cat.toObject() : cat;
        return [String(plain?._id || plain?.id || ""), plain];
      })
    );

    const produtosNormalizados = normalizeProdutoListResponse(produtos).map((produto) => {
      const categoriaId = String(
        produto?.categoria?._id ||
        produto?.categoria?.id ||
        produto?.categoria ||
        ""
      );
      const categoria = categoriaMap.get(categoriaId);

      if (!categoria) {
        return {
          ...produto,
          categoria: categoriaId || null,
          categoriaId: categoriaId || null,
          categoriaNome: "Sem categoria",
        };
      }

      return {
        ...produto,
        categoria: {
          _id: categoria._id || categoria.id || categoriaId,
          id: categoria.id || categoria._id || categoriaId,
          nome: categoria.nome || "Sem categoria",
          ordem: Number(categoria.ordem || 0),
          ativa: categoria.ativa !== false,
          permiteSabores: categoria.permiteSabores === true,
          pizzaMultisabor: categoria.pizzaMultisabor === true,
          calculoPrecoPor: categoria.calculoPrecoPor || "maior",
          maxSabores: Number(categoria.maxSabores || 1),
          tiposExtras: categoria.tiposExtras || [],
          saboresDisponiveis: categoria.saboresDisponiveis || [],
          bordasDisponiveis: categoria.bordasDisponiveis || [],
          adicionaisDisponiveis: categoria.adicionaisDisponiveis || [],
          complementosDisponiveis: categoria.complementosDisponiveis || [],
        },
        categoriaId,
        categoriaNome: categoria.nome || "Sem categoria",
      };
    });

    res.json(produtosNormalizados);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ erro: "Erro ao buscar produtos." });
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

    produto.destaque = !!destaque;
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
};
