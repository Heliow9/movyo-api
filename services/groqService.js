const axios = require("axios");
const crypto = require("crypto");

const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-20b";
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
const AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || "whisper-large-v3-turbo";
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.GROQ_CACHE_TTL_MS || 86_400_000));
const suggestionCache = new Map();

function requireApiKey() {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("A IA ainda não foi configurada no servidor.");
    err.code = "GROQ_NOT_CONFIGURED";
    err.status = 503;
    throw err;
  }
  return apiKey;
}

function jsonFromText(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("A Groq retornou uma resposta vazia.");
  try { return JSON.parse(text); } catch (_) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error("A Groq não retornou JSON válido.");
}

async function groqJson({ messages, model = TEXT_MODEL, maxTokens = 900, cacheKey }) {
  if (cacheKey) {
    const cached = suggestionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, _cache: true };
    suggestionCache.delete(cacheKey);
  }

  const response = await axios.post(
    `${GROQ_BASE_URL}/chat/completions`,
    {
      model,
      messages,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      stream: false,
    },
    {
      timeout: Number(process.env.GROQ_TIMEOUT_MS || 12_000),
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
      },
    }
  );

  const parsed = jsonFromText(response.data?.choices?.[0]?.message?.content);
  if (cacheKey) suggestionCache.set(cacheKey, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
  return parsed;
}

function makeCacheKey(restauranteId, payload) {
  return crypto.createHash("sha256").update(`${restauranteId}:${JSON.stringify(payload)}`).digest("hex");
}

async function suggestProduct({ restauranteId, produto, categoria, categorias, nomesExistentes, mode = "completar" }) {
  const safeInput = {
    mode,
    produto,
    categoria,
    categorias: (categorias || []).slice(0, 80),
    nomesExistentes: (nomesExistentes || []).slice(0, 500),
  };
  const cacheKey = makeCacheKey(restauranteId, safeInput);
  return groqJson({
    cacheKey,
    messages: [
      {
        role: "system",
        content: [
          "Você auxilia o cadastro de produtos de restaurantes brasileiros.",
          "Responda somente JSON. Não invente preço, ingredientes, alergênicos, informação nutricional, vegano ou sem glúten.",
          "Use português do Brasil, descrição comercial objetiva com no máximo 220 caracteres e sem promessas falsas.",
          "setorImpressao deve ser auto, pizzaria, chapa, cozinha, bar, sobremesa ou nenhum.",
          "tipoItem deve ser comum ou pizza. Sugira adicionais apenas como nomes; preço sempre deve ser 0.",
          "Formato: {nome,descricao,termoImagem,tipoItem,maxSabores,calculoPrecoPor,imprimir,setorImpressao,destaque,ativoVitrine,palavrasChave,adicionaisSugeridos,complementosSugeridos,duplicadoProvavel,alertas}.",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify(safeInput) },
    ],
  });
}

async function parseProductText({ restauranteId, texto, categorias, nomesExistentes }) {
  return groqJson({
    cacheKey: makeCacheKey(restauranteId, { voz: texto, categorias, nomesExistentes }),
    messages: [
      {
        role: "system",
        content: "Transforme a fala sobre um produto em JSON para cadastro de restaurante. Não invente dados ausentes. Use o formato {nome,descricao,precoBase,categoriaNome,tipoItem,maxSabores,calculoPrecoPor,imprimir,setorImpressao,destaque,ativoVitrine,termoImagem,adicionaisSugeridos,complementosSugeridos,alertas}. Valores monetários devem ser números. Responda somente JSON.",
      },
      { role: "user", content: JSON.stringify({ texto, categorias, nomesExistentes: (nomesExistentes || []).slice(0, 500) }) },
    ],
  });
}

async function transcribeAudio(file) {
  const form = new FormData();
  form.append("model", AUDIO_MODEL);
  form.append("language", "pt");
  form.append("response_format", "json");
  form.append("prompt", "Cadastro de produtos, cardápio, preços em reais, ingredientes e categorias de restaurante Movyo.");
  form.append("file", new Blob([file.buffer], { type: file.mimetype || "audio/webm" }), file.originalname || "produto.webm");

  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireApiKey()}` },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.GROQ_AUDIO_TIMEOUT_MS || 30_000)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "Falha ao transcrever o áudio.");
  return String(body.text || "").trim();
}

async function extractProductsFromText({ restauranteId, text, categorias }) {
  return groqJson({
    cacheKey: makeCacheKey(restauranteId, { cardapio: text, categorias }),
    maxTokens: 4000,
    messages: [
      {
        role: "system",
        content: "Extraia produtos de um cardápio brasileiro. Responda somente JSON no formato {produtos:[{nome,descricao,precoBase,categoriaNome,tipoItem,maxSabores,termoImagem}],alertas:[]}. Não invente preços nem ingredientes. Use null quando ausente. Máximo de 60 produtos.",
      },
      { role: "user", content: JSON.stringify({ cardapio: String(text || "").slice(0, 80_000), categorias }) },
    ],
  });
}

async function extractProductsFromImage({ restauranteId, file, categorias }) {
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  return groqJson({
    model: VISION_MODEL,
    maxTokens: 4000,
    messages: [
      {
        role: "system",
        content: "Leia o cardápio da imagem via OCR e extraia somente dados visíveis. Responda JSON {produtos:[{nome,descricao,precoBase,categoriaNome,tipoItem,maxSabores,termoImagem}],alertas:[]}. Não invente. Máximo de 60 produtos.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: JSON.stringify({ categorias, restauranteId }) },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
}

module.exports = {
  suggestProduct,
  parseProductText,
  transcribeAudio,
  extractProductsFromText,
  extractProductsFromImage,
  models: { TEXT_MODEL, VISION_MODEL, AUDIO_MODEL },
};
