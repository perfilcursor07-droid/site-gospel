const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

function garantirUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function salvarComoWebp(buffer, prefixo = 'ai') {
  garantirUploads();
  const nome = `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  const destino = path.join(UPLOADS_DIR, nome);

  if (sharp) {
    await sharp(buffer)
      .rotate()
      .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(destino);
    return `/uploads/${nome}`;
  }

  const nomeJpg = nome.replace(/\.webp$/, '.jpg');
  fs.writeFileSync(path.join(UPLOADS_DIR, nomeJpg), buffer);
  return `/uploads/${nomeJpg}`;
}

module.exports = { salvarComoWebp, UPLOADS_DIR };
