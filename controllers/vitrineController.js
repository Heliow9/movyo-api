const { queryWithRetry } = require("../lib/mysqlRetry");
const { planHasFeature } = require("../utils/planRules");

const cardapioCache = new Map();
const CARDAPIO_CACHE_MS = Math.max(0, Number(process.env.VITRINE_CARDAPIO_CACHE_MS || 30000));

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (["false", "0", "nao", "não", "no", "off"].includes(s)) return false;
  if (["true", "1", "sim", "yes", "on"].includes(s)) return true;
  return fallback;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isProdutoDestaque(p = {}) {
  const v = p.destaque ?? p.emDestaque ?? p.isDestaque ?? p.destaqueVitrine;
  return asBool(v, false);
}

function normalizeSlug(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function buildPaymentFlags(restaurante) {
  const canOnlinePayments = planHasFeature(restaurante, "onlinePayments");
  const mercadoPago = parseJsonSafe(restaurante?.mercadoPago, {});
  const mpConectado = canOnlinePayments && asBool(mercadoPago?.conectado, false);
  const pagamentoCartaoAtivo = asBool(restaurante?.pagamentoCartaoAtivo, false) && mpConectado;
  return {
    mpConectado,
    pagamentoCartaoAtivo,
    taxaCartaoCreditoAvistaPercent: asNumber(restaurante?.taxaCartaoCreditoAvistaPercent, 3.8),
  };
}

function normalizeRestaurante(row) {
  if (!row) return null;
  const mercadoPago = parseJsonSafe(row.mercadoPago, {});
  const localizacao = parseJsonSafe(row.localizacao, null);
  const base = {
    _id: row.id,
    id: row.id,
    nome: row.nome || "",
    logoUrl: row.logoUrl || "",
    logoSlug: row.logoSlug || "",
    slugIdentificador: row.slugIdentificador || "",
    horariosFuncionamento: parseJsonSafe(row.horariosFuncionamento, {}),
    horarioInicio: row.horarioInicio || null,
    horarioFim: row.horarioFim || null,
    enderecoRua: row.enderecoRua || "",
    enderecoNumero: row.enderecoNumero || "",
    enderecoBairro: row.enderecoBairro || "",
    enderecoCidade: row.enderecoCidade || "",
    enderecoEstado: row.enderecoEstado || "",
    telefone: row.telefone || "",
    ativo: asBool(row.ativo, true),
    plano: row.plano || "free",
    statusAssinatura: row.statusAssinatura || "ativo",
    dataFimPlano: row.dataFimPlano || null,
    mercadoPago,
    localizacao,
    tempoMedioEntregaMin: asNumber(row.tempoMedioEntregaMin, 45),
    tempoAutoCancelamentoVitrineMin: asNumber(row.tempoAutoCancelamentoVitrineMin, 6),
    maxPedidosPorEntregador: asNumber(row.maxPedidosPorEntregador ?? row.pedidosPorEntregador, 3),
    pedidosPorEntregador: asNumber(row.pedidosPorEntregador ?? row.maxPedidosPorEntregador, 3),
    taxaConvenienciaPix: asNumber(row.taxaConvenienciaPix, 0.5),
    endereco: {
      rua: row.enderecoRua || "",
      numero: row.enderecoNumero || "",
      bairro: row.enderecoBairro || "",
      cidade: row.enderecoCidade || "",
      estado: row.enderecoEstado || "",
    },
  };
  return { ...base, ...buildPaymentFlags({ ...row, mercadoPago }) };
}

function normalizeCategoria(row) {
  const pizzaMultisabor = asBool(row.pizzaMultisabor, false);
  const permiteSabores = asBool(row.permiteSabores, false);
  const tipo = permiteSabores || pizzaMultisabor ? "pizza" : "simple_item";
  const maxSabores = asNumber(row.maxSabores, pizzaMultisabor ? 2 : 1) || (pizzaMultisabor ? 2 : 1);
  return {
    _id: row.id,
    id: row.id,
    restaurante: row.restaurante,
    nome: row.nome || "",
    slug: row.slug || "",
    ativa: asBool(row.ativa, true),
    ordem: asNumber(row.ordem, 0),
    permiteSabores,
    permiteBordas: asBool(row.permiteBordas, false),
    permiteAdicionais: asBool(row.permiteAdicionais, false),
    permiteComplementos: asBool(row.permiteComplementos, false),
    pizzaMultisabor,
    tipo,
    maxSabores,
    calculoPrecoPor: row.calculoPrecoPor || "maior",
    tiposExtras: parseJsonSafe(row.tiposExtras, []),
    saboresDisponiveis: parseJsonSafe(row.saboresDisponiveis, []),
    bordasDisponiveis: parseJsonSafe(row.bordasDisponiveis, []),
    adicionaisDisponiveis: parseJsonSafe(row.adicionaisDisponiveis, []),
    complementosDisponiveis: parseJsonSafe(row.complementosDisponiveis, []),
    itens: [],
  };
}

function normalizeProduto(row, categoria) {
  const categoriaTipo = categoria?.tipo || "simple_item";
  const tipoTexto = String(row.tipoItem || row.tipo || categoriaTipo || "").toLowerCase();
  const isPizza = tipoTexto.includes("pizza") || asBool(row.pizzaMultisabor, false) || categoriaTipo === "pizza";
  const preco = asNumber(row.preco ?? row.precoBase, 0);
  const maxSabores = isPizza ? (asNumber(row.maxSabores, 0) || categoria?.maxSabores || 1) : 1;
  return {
    _id: row.id,
    id: row.id,
    restaurante: row.restaurante,
    categoria: row.categoria,
    nome: row.nome || "",
    descricao: row.descricao || "",
    preco,
    precoBase: preco,
    imagem: row.imagem || "",
    destaque: isProdutoDestaque(row),
    ordem: asNumber(row.ordem, 0),
    ativo: asBool(row.ativo, true),
    ativoVitrine: asBool(row.ativoVitrine, true),
    disponivel: asBool(row.disponivel, true),
    imprimeNaCozinha: asBool(row.imprimeNaCozinha, true),
    tempoPreparoMin: asNumber(row.tempoPreparoMin, 0),
    extras: parseJsonSafe(row.extras, {}),
    estoque: parseJsonSafe(row.estoque, {}),
    sabores: parseJsonSafe(row.sabores, []),
    bordas: parseJsonSafe(row.bordas, []),
    adicionais: parseJsonSafe(row.adicionais, []),
    complementos: parseJsonSafe(row.complementos, []),
    saboresDisponiveis: parseJsonSafe(row.sabores, [])?.length ? parseJsonSafe(row.sabores, []) : (categoria?.saboresDisponiveis || []),
    bordasDisponiveis: parseJsonSafe(row.bordas, [])?.length ? parseJsonSafe(row.bordas, []) : (categoria?.bordasDisponiveis || []),
    adicionaisDisponiveis: parseJsonSafe(row.adicionais, [])?.length ? parseJsonSafe(row.adicionais, []) : (categoria?.adicionaisDisponiveis || []),
    complementosDisponiveis: parseJsonSafe(row.complementos, [])?.length ? parseJsonSafe(row.complementos, []) : (categoria?.complementosDisponiveis || []),
    tipoItem: isPizza ? "pizza" : "comum",
    categoriaType: isPizza ? "pizza" : "simple_item",
    pizzaMultisabor: isPizza && (asBool(row.pizzaMultisabor, false) || maxSabores > 1 || asBool(categoria?.pizzaMultisabor, false)),
    calculoPrecoPor: row.calculoPrecoPor || categoria?.calculoPrecoPor || "maior",
    tiposExtras: categoria?.tiposExtras || [],
    maxSabores,
  };
}

async function buscarRestaurantePorSlug(slug) {
  const slugLimpo = normalizeSlug(slug);
  if (!slugLimpo) return null;

  const columns = `id, nome, telefone, logoUrl, logoSlug, slugIdentificador, horariosFuncionamento,
    enderecoRua, enderecoNumero, enderecoBairro, enderecoCidade, enderecoEstado,
    localizacao, ativo, plano, statusAssinatura, dataFimPlano, mercadoPago,
    pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent, taxaConvenienciaPix,
    tempoMedioEntregaMin, tempoAutoCancelamentoVitrineMin, maxPedidosPorEntregador,
    pedidosPorEntregador, updated_at`;

  const [rows] = await queryWithRetry(
    `SELECT ${columns}
       FROM restaurantes
      WHERE slugIdentificador = ? OR logoSlug = ? OR id = ?
      LIMIT 1`,
    [slugLimpo, slugLimpo, slugLimpo],
    { label: "vitrine.restaurante.slug" }
  );
  if (rows?.[0]) return rows[0];

  const [rowsCase] = await queryWithRetry(
    `SELECT ${columns}
       FROM restaurantes
      WHERE LOWER(slugIdentificador) = LOWER(?) OR LOWER(logoSlug) = LOWER(?)
      LIMIT 1`,
    [slugLimpo, slugLimpo],
    { label: "vitrine.restaurante.slug_ci" }
  );
  return rowsCase?.[0] || null;
}

function setPublicCacheHeaders(res, seconds = 30) {
  res.setHeader("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=300`);
}

exports.cardapioPorSlug = async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ erro: "Slug inválido." });

    const cacheKey = slug.toLowerCase();
    const cached = CARDAPIO_CACHE_MS ? cardapioCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.ts < CARDAPIO_CACHE_MS) {
      setPublicCacheHeaders(res, Math.ceil(CARDAPIO_CACHE_MS / 1000));
      return res.json({ ...cached.payload, cache: true });
    }

    const restauranteRow = await buscarRestaurantePorSlug(slug);
    const restaurante = normalizeRestaurante(restauranteRow);

    if (!restaurante || !restaurante.ativo) {
      return res.status(404).json({ erro: "Restaurante não encontrado ou inativo.", slug });
    }
    if (!planHasFeature(restaurante, "digitalMenu")) {
      return res.status(403).json({ erro: "Cardapio digital indisponivel no plano atual." });
    }

    const [categoriaRows] = await queryWithRetry(
      `SELECT * FROM categorias_produto
        WHERE restaurante = ? AND (ativa IS NULL OR ativa <> 0)
        ORDER BY COALESCE(ordem, 0), nome`,
      [restaurante._id],
      { label: "vitrine.categorias" }
    );

    const categorias = (categoriaRows || []).map(normalizeCategoria);
    const categoriasById = new Map(categorias.map((c) => [String(c._id), c]));

    const [produtoRows] = await queryWithRetry(
      `SELECT * FROM produtos
        WHERE restaurante = ?
          AND (ativo IS NULL OR ativo <> 0)
          AND (ativoVitrine IS NULL OR ativoVitrine <> 0)
        ORDER BY categoria, COALESCE(ordem, 0), nome`,
      [restaurante._id],
      { label: "vitrine.produtos" }
    );

    for (const row of produtoRows || []) {
      const cat = categoriasById.get(String(row.categoria));
      if (!cat) continue;
      cat.itens.push(normalizeProduto(row, cat));
    }

    const produtosPorCategoria = categorias
      .map((cat) => ({ ...cat, itens: (cat.itens || []).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)) }))
      .filter((cat) => cat.itens.length > 0);

    const versaoCardapio = [
      restauranteRow?.updated_at,
      ...(categoriaRows || []).map((r) => r.updated_at),
      ...(produtoRows || []).map((r) => r.updated_at),
    ]
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0] || Date.now();

    const payload = {
      restaurante,
      produtosPorCategoria,
      versaoCardapio: new Date(versaoCardapio).toISOString(),
    };

    if (CARDAPIO_CACHE_MS) cardapioCache.set(cacheKey, { ts: Date.now(), payload });
    setPublicCacheHeaders(res, Math.ceil(CARDAPIO_CACHE_MS / 1000) || 30);
    return res.json(payload);
  } catch (err) {
    console.error("Erro em /api/vitrine/cardapio:", err);
    return res.status(500).json({ erro: "Erro interno ao carregar vitrine." });
  }
};

exports.checkoutConfig = async (req, res) => {
  try {
    const restauranteId = String(req.params.restauranteId || req.params.id || "").trim();
    if (!restauranteId) return res.status(400).json({ erro: "Restaurante não informado." });

    const [rows] = await queryWithRetry(
      `SELECT id, nome, logoUrl, logoSlug, slugIdentificador, horariosFuncionamento,
              enderecoRua, enderecoNumero, enderecoBairro, enderecoCidade, enderecoEstado,
              localizacao, ativo, plano, statusAssinatura, dataFimPlano, mercadoPago,
              pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent, taxaConvenienciaPix,
              tempoMedioEntregaMin, maxPedidosPorEntregador, pedidosPorEntregador
         FROM restaurantes
        WHERE id = ?
        LIMIT 1`,
      [restauranteId],
      { label: "vitrine.checkout.restaurante" }
    );

    const restaurante = normalizeRestaurante(rows?.[0]);
    if (!restaurante || !restaurante.ativo) return res.status(404).json({ erro: "Restaurante não encontrado ou inativo." });
    if (!planHasFeature(restaurante, "digitalMenu")) return res.status(403).json({ erro: "Cardapio digital indisponivel no plano atual." });

    const [freteRows] = await queryWithRetry(
      `SELECT * FROM fretes WHERE restaurante = ? AND (ativo IS NULL OR ativo <> 0) LIMIT 1`,
      [restauranteId],
      { label: "vitrine.checkout.frete" }
    );
    const freteRow = freteRows?.[0] || null;
    const frete = freteRow ? {
      _id: freteRow.id,
      id: freteRow.id,
      restaurante: freteRow.restaurante,
      tipo: freteRow.tipo || "raio",
      taxaFixa: asNumber(freteRow.taxaFixa, 0),
      valorPorKm: asNumber(freteRow.valorPorKm, 0),
      raioKm: asNumber(freteRow.raioKm, 0),
      faixasRaio: parseJsonSafe(freteRow.faixasRaio, []),
      areas: parseJsonSafe(freteRow.areas, []),
      ativo: asBool(freteRow.ativo, true),
    } : null;

    setPublicCacheHeaders(res, 15);
    return res.json({
      restaurante,
      mercadoPago: {
        conectado: restaurante.mpConectado,
        pixAtivo: restaurante.mpConectado,
        cartaoAtivo: restaurante.pagamentoCartaoAtivo,
      },
      frete,
    });
  } catch (err) {
    console.error("Erro em /api/vitrine/checkout-config:", err);
    return res.status(500).json({ erro: "Erro interno ao carregar checkout." });
  }
};
