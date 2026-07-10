const { Post } = require('../models');
const { obterUrlBase } = require('../utils/requestUrl');

function sanitizarXml(valor) {
  return String(valor ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .trim();
}

function escapeXml(valor) {
  return sanitizarXml(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function gerarFeedRss(config, req, limite = 50) {
  const base = obterUrlBase(req, config);
  const nomeSite = (config.site_nome || 'Site Gospel').trim();
  const descricaoSite = (config.seo_descricao || '').trim();

  const posts = await Post.findAll({
    where: { status: 'publicado' },
    include: ['autor', 'categoria'],
    order: [['publicadoEm', 'DESC']],
    limit: Math.min(Math.max(limite, 1), 100)
  });

  const itens = posts.map((post) => {
    const link = `${base}/post/${post.slug}`;
    const pubDate = post.publicadoEm ? new Date(post.publicadoEm).toUTCString() : new Date(post.updatedAt).toUTCString();
    const descricao = escapeXml(post.resumo || stripHtml(post.conteudo).slice(0, 300));
    const autor = escapeXml(post.autor?.nome || nomeSite);
    return (
      '    <item>\n' +
      `      <title>${escapeXml(post.titulo)}</title>\n` +
      `      <link>${escapeXml(link)}</link>\n` +
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>\n` +
      `      <pubDate>${pubDate}</pubDate>\n` +
      `      <description>${descricao}</description>\n` +
      `      <author>${autor}</author>\n` +
      (post.categoria ? `      <category>${escapeXml(post.categoria.nome)}</category>\n` : '') +
      '    </item>'
    );
  });

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '  <channel>\n' +
    `    <title>${escapeXml(nomeSite)}</title>\n` +
    `    <link>${escapeXml(base)}/</link>\n` +
    `    <description>${escapeXml(descricaoSite || nomeSite)}</description>\n` +
    '    <language>pt-BR</language>\n' +
    `    <atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml"/>\n` +
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    itens.join('\n') +
    '\n  </channel>\n' +
    '</rss>'
  );
}

module.exports = { gerarFeedRss };
