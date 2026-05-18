const axios = require("axios");
const ImagemFavorita = require("../models/ImagemFavorita");

// ----------------- helpers -----------------
function normalizeUrl(u) {
  return String(u || "").trim();
}

function uniqUrls(urls) {
  const s = new Set();
  (urls || []).forEach((u) => {
    const nu = normalizeUrl(u);
    if (nu) s.add(nu);
  });
  return Array.from(s);
}

async function getOrCreateDoc(restauranteId) {
  let doc = await ImagemFavorita.findOne({ restaurante: restauranteId });
  if (!doc) {
    doc = await ImagemFavorita.create({ restaurante: restauranteId, urls: [] });
  }
  return doc;
}

// ================= FAVORITAS =================

// GET /api/imagens/favoritas
exports.listarFavoritas = async (req, res) => {
  try {
    const restauranteId =
      req.restauranteId || req.user?.restauranteId || req.user?._id;

    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não identificado." });
    }

    const doc = await getOrCreateDoc(restauranteId);
    return res.json({ data: doc.urls || [] });
  } catch (err) {
    console.error("listarFavoritas:", err);
    return res.status(500).json({ message: "Erro ao listar favoritas." });
  }
};

// POST /api/imagens/favoritas  { url }
exports.adicionarFavorita = async (req, res) => {
  try {
    const restauranteId =
      req.restauranteId || req.user?.restauranteId || req.user?._id;

    const url = normalizeUrl(req.body?.url);

    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não identificado." });
    }
    if (!url) {
      return res.status(400).json({ message: "URL é obrigatória." });
    }

    const doc = await getOrCreateDoc(restauranteId);

    const merged = uniqUrls([url, ...(doc.urls || [])]);

    doc.urls = merged;
    await doc.save();

    return res.json({ data: doc.urls });
  } catch (err) {
    console.error("adicionarFavorita:", err);
    return res.status(500).json({ message: "Erro ao adicionar favorita." });
  }
};

// DELETE /api/imagens/favoritas  { url }
exports.removerFavorita = async (req, res) => {
  try {
    const restauranteId =
      req.restauranteId || req.user?.restauranteId || req.user?._id;

    const url = normalizeUrl(req.body?.url);

    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não identificado." });
    }
    if (!url) {
      return res.status(400).json({ message: "URL é obrigatória." });
    }

    const doc = await getOrCreateDoc(restauranteId);

    doc.urls = (doc.urls || []).filter((u) => normalizeUrl(u) !== url);
    await doc.save();

    return res.json({ data: doc.urls });
  } catch (err) {
    console.error("removerFavorita:", err);
    return res.status(500).json({ message: "Erro ao remover favorita." });
  }
};

// POST /api/imagens/favoritas/sync  { urls: [...] }
// ✅ usa pra: ao carregar produtos, enviar as imagens já usadas e "mergear" no banco
exports.syncFavoritas = async (req, res) => {
  try {
    const restauranteId =
      req.restauranteId || req.user?.restauranteId || req.user?._id;

    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];

    if (!restauranteId) {
      return res.status(401).json({ message: "Restaurante não identificado." });
    }

    const doc = await getOrCreateDoc(restauranteId);

    doc.urls = uniqUrls([...(doc.urls || []), ...urls]);
    await doc.save();

    return res.json({ data: doc.urls });
  } catch (err) {
    console.error("syncFavoritas:", err);
    return res.status(500).json({ message: "Erro ao sincronizar favoritas." });
  }
};

// ================= BUSCA DE IMAGENS =================

// GET /api/imagens/buscar?q=termo
// ✅ Pixabay proxy
exports.buscarImagens = async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    if (!q) return res.status(400).json({ message: "Parâmetro q é obrigatório." });

    const key = process.env.PIXABAY_API_KEY;
    if (!key) {
      return res.status(500).json({
        message: "PIXABAY_API_KEY não configurada no .env",
      });
    }

    // Pixabay: https://pixabay.com/api/docs/
    const url = "https://pixabay.com/api/";
    const params = {
      key,
      q,
      image_type: "photo",
      safesearch: "true",
      per_page: 40,
    };

    const r = await axios.get(url, { params, timeout: 20000 });
    const hits = Array.isArray(r.data?.hits) ? r.data.hits : [];

    const results = hits
      .map((h) => ({
        url: h.largeImageURL || h.webformatURL || h.previewURL,
        thumb: h.webformatURL || h.previewURL || h.largeImageURL,
      }))
      .filter((x) => x.url);

    return res.json({ results });
  } catch (err) {
    console.error("buscarImagens:", err?.response?.data || err);
    return res.status(500).json({ message: "Erro ao buscar imagens." });
  }
};
