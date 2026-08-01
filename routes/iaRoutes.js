const express = require("express");
const multer = require("multer");
const authRestaurante = require("../middlewares/authRestaurante");
const rateLimitIa = require("../middlewares/rateLimitIa");
const controller = require("../controllers/iaProdutoController");

const router = express.Router();
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const uploadMenu = multer({
  storage: multer.memoryStorage(),
  // Base64 aumenta o tamanho enviado ao modelo de visão; 12 MB mantém folga no limite da Groq.
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    callback(allowed.includes(file.mimetype) ? null : new Error("Envie PDF, PNG, JPG ou WEBP."), allowed.includes(file.mimetype));
  },
});

router.use(authRestaurante, rateLimitIa);
router.post("/produtos/sugerir", controller.sugerir);
router.post("/produtos/transcrever", uploadAudio.single("audio"), controller.transcrever);
router.post("/produtos/importar-cardapio", uploadMenu.single("arquivo"), controller.importarCardapio);

router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "O arquivo é grande demais para análise." });
  }
  return res.status(400).json({ message: err?.message || "Arquivo inválido." });
});

module.exports = router;
