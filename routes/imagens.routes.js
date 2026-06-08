const express = require("express");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const router = express.Router();
const uploadDir = path.join(__dirname, "..", "uploads", "produtos");
fs.mkdirSync(uploadDir, { recursive: true });

const imagens = require("../controllers/imagens.controller");
const authRestaurante = require("../middlewares/authRestaurante");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = String(file.originalname || "imagem").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!String(file.mimetype || "").startsWith("image/")) return cb(new Error("Envie somente imagens."));
    cb(null, true);
  },
});

router.use(authRestaurante);

router.get("/buscar", imagens.buscarImagens);
router.post("/importar-url", imagens.importarUrl);
router.post("/upload", upload.single("image"), imagens.uploadImagem);

router.get("/favoritas", imagens.listarFavoritas);
router.post("/favoritas", imagens.adicionarFavorita);
router.delete("/favoritas", imagens.removerFavorita);
router.post("/favoritas/sync", imagens.syncFavoritas);

module.exports = router;
