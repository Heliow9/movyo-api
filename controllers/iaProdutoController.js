const pdfParse = require("pdf-parse");
const groq = require("../services/groqService");

const text = (value, max = 220) => String(value || "").trim().slice(0, max);
const list = (value, max = 20) => (Array.isArray(value) ? value : []).map((item) => text(typeof item === "string" ? item : item?.nome, 70)).filter(Boolean).slice(0, max);
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const sector = (value) => ["auto", "pizzaria", "chapa", "cozinha", "bar", "sobremesa", "nenhum"].includes(value) ? value : "auto";
const money = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : "";
};

const comparable = (value) => text(value, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function probableDuplicate(name, existing = []) {
  const target = comparable(name);
  if (!target) return "";
  const source = Array.isArray(existing) ? existing : [];
  const exact = source.find((item) => comparable(item) === target);
  if (exact) return text(exact, 90);
  const contained = source.find((item) => {
    const candidate = comparable(item);
    return candidate.length >= 5 && target.length >= 5 && (candidate.includes(target) || target.includes(candidate));
  });
  return text(contained, 90);
}

function sanitizeSuggestion(raw = {}) {
  return {
    nome: text(raw.nome, 90),
    descricao: text(raw.descricao, 300),
    precoBase: money(raw.precoBase),
    categoriaNome: text(raw.categoriaNome, 80),
    termoImagem: text(raw.termoImagem, 100),
    tipoItem: raw.tipoItem === "pizza" ? "pizza" : "comum",
    maxSabores: Math.max(1, Math.min(12, Math.round(Number(raw.maxSabores || 1)))),
    calculoPrecoPor: raw.calculoPrecoPor === "media" ? "media" : "maior",
    imprimir: bool(raw.imprimir, true),
    setorImpressao: sector(raw.setorImpressao),
    destaque: bool(raw.destaque, false),
    ativoVitrine: bool(raw.ativoVitrine, true),
    palavrasChave: list(raw.palavrasChave, 12),
    adicionaisSugeridos: list(raw.adicionaisSugeridos, 15),
    complementosSugeridos: list(raw.complementosSugeridos, 15),
    duplicadoProvavel: text(raw.duplicadoProvavel, 90),
    alertas: list(raw.alertas, 10),
  };
}

function categories(body) {
  let source = body?.categorias;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch (_) { source = []; }
  }
  return (Array.isArray(source) ? source : []).map((c) => ({ id: text(c?.id || c?._id, 80), nome: text(c?.nome, 80) })).filter((c) => c.nome).slice(0, 80);
}

function errorResponse(res, err) {
  const upstream = err?.response?.data?.error?.message || err?.response?.data?.message;
  const status = Number(err?.status || (err?.response?.status === 429 ? 429 : 502));
  console.error("IA Groq:", upstream || err?.message || err);
  return res.status(status).json({ message: upstream || err?.message || "Não foi possível consultar a IA agora.", code: err?.code || "GROQ_ERROR" });
}

exports.sugerir = async (req, res) => {
  try {
    const produto = req.body?.produto || {};
    if (!text(produto.nome) && !text(produto.descricao)) return res.status(400).json({ message: "Informe o nome ou a descrição do produto." });
    const result = await groq.suggestProduct({
      restauranteId: req.restauranteId,
      produto: {
        nome: text(produto.nome, 90), descricao: text(produto.descricao, 300), precoBase: money(produto.precoBase),
        tipoItem: produto.tipoItem === "pizza" ? "pizza" : "comum", setorImpressao: sector(produto.setorImpressao),
      },
      categoria: req.body?.categoria ? { id: text(req.body.categoria.id || req.body.categoria._id), nome: text(req.body.categoria.nome) } : null,
      categorias: categories(req.body),
      nomesExistentes: list(req.body?.nomesExistentes, 500),
      mode: req.body?.mode === "descricao" ? "descricao" : "completar",
    });
    const sugestao = sanitizeSuggestion(result);
    sugestao.duplicadoProvavel = probableDuplicate(sugestao.nome || produto.nome, req.body?.nomesExistentes) || sugestao.duplicadoProvavel;
    return res.json({ sugestao, cache: !!result?._cache, modelos: groq.models });
  } catch (err) { return errorResponse(res, err); }
};

exports.transcrever = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Envie um arquivo de áudio." });
    const transcricao = await groq.transcribeAudio(req.file);
    if (!transcricao) return res.status(422).json({ message: "Não consegui entender o áudio." });
    const parsed = await groq.parseProductText({
      restauranteId: req.restauranteId,
      texto: transcricao,
      categorias: categories(req.body),
      nomesExistentes: (() => { try { return JSON.parse(req.body?.nomesExistentes || "[]"); } catch (_) { return []; } })(),
    });
    const sugestao = sanitizeSuggestion(parsed);
    const nomesExistentes = (() => { try { return JSON.parse(req.body?.nomesExistentes || "[]"); } catch (_) { return []; } })();
    sugestao.duplicadoProvavel = probableDuplicate(sugestao.nome, nomesExistentes) || sugestao.duplicadoProvavel;
    return res.json({ transcricao, sugestao, modelos: groq.models });
  } catch (err) { return errorResponse(res, err); }
};

exports.importarCardapio = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Envie uma imagem ou PDF do cardápio." });
    let result;
    const cats = (() => { try { return JSON.parse(req.body?.categorias || "[]"); } catch (_) { return []; } })();
    if (req.file.mimetype === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      if (!text(parsed.text)) return res.status(422).json({ message: "Este PDF não contém texto legível. Exporte as páginas como imagem e tente novamente." });
      result = await groq.extractProductsFromText({ restauranteId: req.restauranteId, text: parsed.text, categorias: cats });
    } else {
      result = await groq.extractProductsFromImage({ restauranteId: req.restauranteId, file: req.file, categorias: cats });
    }
    const produtos = (Array.isArray(result?.produtos) ? result.produtos : []).slice(0, 60).map(sanitizeSuggestion).filter((p) => p.nome);
    return res.json({ produtos, alertas: list(result?.alertas, 15), modelos: groq.models });
  } catch (err) { return errorResponse(res, err); }
};
