const { obterUrlBase } = require('../utils/requestUrl');

function hostDaUrl(base) {
  try {
    return new URL(base).host;
  } catch {
    return '';
  }
}

async function pingSitemap(url) {
  if (!url) return;
  const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(url)}`;
  await fetch(pingUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(8000)
  }).catch(() => {});
}

async function pingIndexNow(config, urls, req) {
  const chave = (config.indexnow_chave || '').trim();
  const base = obterUrlBase(req, config);
  const host = hostDaUrl(base);
  if (!chave || !host || !urls.length) return;

  const lista = [...new Set(urls.filter(Boolean))].slice(0, 100);
  const keyLocation = `${base}/${chave}.txt`;

  await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key: chave,
      keyLocation,
      urlList: lista
    }),
    signal: AbortSignal.timeout(10000)
  }).catch(() => {});
}

async function notificarPublicacao(config, slug, req = null) {
  const base = obterUrlBase(req, config);
  if (!base || !slug) return;

  const postUrl = `${base}/post/${slug}`;
  const sitemaps = [
    `${base}/sitemap.xml`,
    `${base}/sitemap-news.xml`,
    `${base}/feed.xml`
  ];

  await Promise.allSettled([
    pingIndexNow(config, [postUrl, ...sitemaps], req),
    ...sitemaps.map((u) => pingSitemap(u))
  ]);
}

function gerarChaveIndexNow() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = { notificarPublicacao, gerarChaveIndexNow, pingIndexNow };
