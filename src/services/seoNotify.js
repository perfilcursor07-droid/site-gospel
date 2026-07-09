const { obterUrlBase } = require('../utils/requestUrl');

/**
 * Notifica indexadores sobre URL nova/atualizada (não bloqueia a publicação).
 * IndexNow: configure INDEXNOW_KEY no .env e hospede /{key}.txt na raiz do site.
 */
async function notificarUrlPublicada(config, req, slug) {
  const base = obterUrlBase(req, config);
  if (!base || !slug) return;

  const url = `${base}/post/${slug}`;
  const key = (process.env.INDEXNOW_KEY || config.indexnow_key || '').trim();
  if (!key) return;

  const host = new URL(base).host;
  const body = JSON.stringify({ host, key, urlList: [url] });

  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {
    console.warn('seoNotify IndexNow:', e.message);
  }
}

function notificarUrlPublicadaEmBackground(config, req, slug) {
  notificarUrlPublicada(config, req, slug).catch(() => {});
}

module.exports = { notificarUrlPublicada, notificarUrlPublicadaEmBackground };
