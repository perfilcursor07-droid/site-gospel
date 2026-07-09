function obterProtocolo(req) {
  const encaminhado = req.get('x-forwarded-proto');
  if (encaminhado) return encaminhado.split(',')[0].trim().toLowerCase();

  let protocolo = (req.protocol || 'http').toLowerCase();
  if (process.env.NODE_ENV === 'production' && protocolo === 'http') {
    protocolo = 'https';
  }
  return protocolo;
}

function obterUrlBase(req, config = {}) {
  const canonica = (config.sitemap_url_canonica || process.env.SITE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (canonica) return canonica;

  if (!req) return '';
  return `${obterProtocolo(req)}://${req.get('host')}`;
}

module.exports = { obterProtocolo, obterUrlBase };
