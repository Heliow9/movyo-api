const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ImagemFavorita = require("../models/ImagemFavorita");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "produtos");
const PUBLIC_PREFIX = "/uploads/produtos";

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function getBaseUrl(req) {
  const envBase = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || "";
  if (envBase) return String(envBase).replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function publicUrl(req, filename) {
  return `${getBaseUrl(req)}${PUBLIC_PREFIX}/${filename}`;
}

function normalizeUrl(u) {
  return String(u || "").trim();
}

function getRestauranteId(req) {
  return req.restauranteId || req.user?.restauranteId || req.user?._id || req.body?.restauranteId;
}

function safeExtFromUrl(url, contentType = "") {
  const byType = String(contentType || "").toLowerCase();
  if (byType.includes("png")) return ".png";
  if (byType.includes("webp")) return ".webp";
  if (byType.includes("gif")) return ".gif";
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
  } catch {}
  return ".jpg";
}

async function addFavoriteUrl(restauranteId, url, tipo = "produto", metadata = {}) {
  const u = normalizeUrl(url);
  if (!restauranteId || !u) return null;

  const existentes = await ImagemFavorita.find({ restauranteId });
  const jaExiste = (existentes || []).find((img) => normalizeUrl(img.url) === u && img.ativo !== false);
  if (jaExiste) return jaExiste;

  return ImagemFavorita.create({ restauranteId, url: u, tipo, metadata, ativo: true });
}

exports.listarFavoritas = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });

    const rows = await ImagemFavorita.find({ restauranteId });
    const urls = [];
    const seen = new Set();
    for (const img of rows || []) {
      if (img.ativo === false) continue;
      const u = normalizeUrl(img.url);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
    }
    return res.json({ data: urls });
  } catch (err) {
    console.error("listarFavoritas:", err);
    return res.status(500).json({ message: "Erro ao listar favoritas." });
  }
};

exports.adicionarFavorita = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const url = normalizeUrl(req.body?.url);
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });
    if (!url) return res.status(400).json({ message: "URL é obrigatória." });

    await addFavoriteUrl(restauranteId, url, "produto", { origem: "manual" });
    const rows = await ImagemFavorita.find({ restauranteId });
    return res.json({ data: (rows || []).filter((x) => x.ativo !== false).map((x) => x.url).filter(Boolean) });
  } catch (err) {
    console.error("adicionarFavorita:", err);
    return res.status(500).json({ message: "Erro ao adicionar favorita." });
  }
};

exports.removerFavorita = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const url = normalizeUrl(req.body?.url);
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });
    if (!url) return res.status(400).json({ message: "URL é obrigatória." });

    const rows = await ImagemFavorita.find({ restauranteId });
    for (const img of rows || []) {
      if (normalizeUrl(img.url) === url) {
        img.ativo = false;
        await img.save();
      }
    }
    const atualizadas = await ImagemFavorita.find({ restauranteId });
    return res.json({ data: (atualizadas || []).filter((x) => x.ativo !== false).map((x) => x.url).filter(Boolean) });
  } catch (err) {
    console.error("removerFavorita:", err);
    return res.status(500).json({ message: "Erro ao remover favorita." });
  }
};

exports.syncFavoritas = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });

    for (const url of urls) {
      await addFavoriteUrl(restauranteId, url, "produto", { origem: "sync_produtos" });
    }
    const rows = await ImagemFavorita.find({ restauranteId });
    return res.json({ data: (rows || []).filter((x) => x.ativo !== false).map((x) => x.url).filter(Boolean) });
  } catch (err) {
    console.error("syncFavoritas:", err);
    return res.status(500).json({ message: "Erro ao sincronizar favoritas." });
  }
};

// ✅ Busca agora retorna somente favoritas do restaurante; não usa API externa.
exports.buscarImagens = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const q = String(req.query?.q || "").trim().toLowerCase();
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });

    const rows = await ImagemFavorita.find({ restauranteId });
    const urls = (rows || [])
      .filter((x) => x.ativo !== false)
      .map((x) => normalizeUrl(x.url))
      .filter(Boolean)
      .filter((url) => !q || url.toLowerCase().includes(q));

    return res.json({ results: Array.from(new Set(urls)).map((url) => ({ url, thumb: url })) });
  } catch (err) {
    console.error("buscarImagens:", err);
    return res.status(500).json({ message: "Erro ao buscar imagens favoritas." });
  }
};

// POST /api/imagens/importar-url { url }
// Baixa a imagem uma vez para o servidor e retorna a URL local.
exports.importarUrl = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    const url = normalizeUrl(req.body?.url);
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });
    if (!url) return res.status(400).json({ message: "URL é obrigatória." });

    ensureUploadDir();
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 25000,
      maxContentLength: 8 * 1024 * 1024,
      headers: { "User-Agent": "MovyoFood/1.0" },
    });

    const contentType = response.headers?.["content-type"] || "";
    if (!String(contentType).startsWith("image/")) {
      return res.status(400).json({ message: "A URL informada não retornou uma imagem." });
    }

    const ext = safeExtFromUrl(url, contentType);
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(response.data));

    const localUrl = publicUrl(req, filename);
    await addFavoriteUrl(restauranteId, localUrl, "produto", { origem: "url", urlOriginal: url });

    return res.json({ url: localUrl, data: localUrl });
  } catch (err) {
    console.error("importarUrl:", err?.response?.status || err?.message || err);
    return res.status(500).json({ message: "Erro ao copiar imagem para o servidor." });
  }
};

// POST /api/imagens/upload multipart/form-data image
exports.uploadImagem = async (req, res) => {
  try {
    const restauranteId = getRestauranteId(req);
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não identificado." });
    if (!req.file) return res.status(400).json({ message: "Arquivo de imagem é obrigatório." });

    const localUrl = publicUrl(req, req.file.filename);
    await addFavoriteUrl(restauranteId, localUrl, "produto", { origem: "upload", filename: req.file.filename });
    return res.json({ url: localUrl, data: localUrl });
  } catch (err) {
    console.error("uploadImagem:", err);
    return res.status(500).json({ message: "Erro ao enviar imagem." });
  }
};
