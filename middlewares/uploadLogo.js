const multer = require("multer");
const path = require("path");
const fs = require("fs");

const dir = path.join(__dirname, "..", "uploads", "logos");
fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
    const restId = req.restauranteId || req.userId || req.user?.id || req.user?._id || "rest";
    const name = `logo_${restId}_${Date.now()}${safeExt}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Formato inválido"), ok);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});
