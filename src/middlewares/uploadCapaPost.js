const multer = require('multer');
const path = require('path');
const { salvarComoWebp, UPLOADS_DIR } = require('../utils/imageProcessor');

const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|gif|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Apenas imagens são permitidas (jpg, png, gif, webp)'), ok);
  }
});

async function converterCapaParaWebp(req, res, next) {
  if (!req.file?.buffer) return next();
  try {
    const url = await salvarComoWebp(req.file.buffer, 'capa');
    const nome = path.basename(url);
    req.file.filename = nome;
    req.file.path = path.join(UPLOADS_DIR, nome);
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = [uploadMemoria.single('imagem'), converterCapaParaWebp];
