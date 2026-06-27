const fs = require("fs");
const path = require("path");
const multer = require("multer");

const dir = path.join(__dirname, "..", "uploads", "comprovantes-entrega");
fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, dir),
  filename: (req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext)
      ? ext
      : ".jpg";
    const pedidoId = String(req.params?.pedidoId || req.params?.id || "pedido")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    callback(null, `entrega_${pedidoId}_${Date.now()}${safeExt}`);
  },
});

module.exports = multer({
  storage,
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    callback(allowed ? null : new Error("Envie uma foto JPG, PNG ou WEBP."), allowed);
  },
  limits: { fileSize: 4 * 1024 * 1024 },
});
