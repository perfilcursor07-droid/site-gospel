const { Post, Page, Category } = require('../models');

const LIMITE_URLS = 50000;
const LIMITE_NEWS_HORAS = 48;
const LIMITE_NEWS_URLS = 1000;

function escapeXml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sim(config, chave, padrao = true) {
  const valor = config[chave];
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === 'sim' || valor === 'on' || valor === '1' || valor === true;
}

function obterBaseUrl(config, req) {
  const canonica = (config.sitemap_url_canonica || '').trim().replace(/\/+$/, '');
  if (canonica) return canonica;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

function formatarLastmod(data) {
  if (!data) return null;
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function montarEntrada({ loc, lastmod, changefreq, prioridade }) {
  const entrada = { loc };
  if (lastmod) entrada.lastmod = formatarLastmod(lastmod);
  if (changefreq) entrada.changefreq = changefreq;
  if (prioridade) entrada.prioridade = prioridade;
  return entrada;
}

async function carregarDados() {
  const [posts, paginas, categorias] = await Promise.all([
    Post.findAll({ where: { status: 'publicado' }, order: [['publicadoEm', 'DESC']] }),
    Page.findAll({ where: { status: 'publicado' } }),
    Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] })
  ]);
  return { posts, paginas, categorias };
}

function montarUrls(config, base, dados) {
  const { posts, paginas, categorias } = dados;
  const urls = [];
  const changefreqPosts = config.sitemap_changefreq_posts || 'daily';
  const changefreqCategorias = config.sitemap_changefreq_categorias || 'weekly';
  const changefreqPaginas = config.sitemap_changefreq_paginas || 'monthly';

  if (sim(config, 'sitemap_incluir_home', true)) {
    const ultimaAtualizacao = posts[0]?.updatedAt || posts[0]?.publicadoEm || null;
    urls.push(montarEntrada({
      loc: `${base}/`,
      lastmod: ultimaAtualizacao,
      changefreq: config.sitemap_changefreq_home || 'daily',
      prioridade: '1.0'
    }));
  }

  if (sim(config, 'sitemap_incluir_posts', true)) {
    posts.forEach((post) => {
      urls.push(montarEntrada({
        loc: `${base}/post/${post.slug}`,
        lastmod: post.updatedAt || post.publicadoEm,
        changefreq: changefreqPosts,
        prioridade: '0.8'
      }));
    });
  }

  if (sim(config, 'sitemap_incluir_categorias', true)) {
    categorias.forEach((categoria) => {
      urls.push(montarEntrada({
        loc: `${base}/categoria/${categoria.slug}`,
        lastmod: categoria.updatedAt,
        changefreq: changefreqCategorias,
        prioridade: '0.6'
      }));
    });
  }

  if (sim(config, 'sitemap_incluir_paginas', true)) {
    paginas.forEach((pagina) => {
      urls.push(montarEntrada({
        loc: `${base}/pagina/${pagina.slug}`,
        lastmod: pagina.updatedAt,
        changefreq: changefreqPaginas,
        prioridade: '0.5'
      }));
    });
  }

  return urls.slice(0, LIMITE_URLS);
}

function renderizarUrlset(urls) {
  const linhas = urls.map((url) => {
    let bloco = `  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n`;
    if (url.lastmod) bloco += `    <lastmod>${escapeXml(url.lastmod)}</lastmod>\n`;
    if (url.changefreq) bloco += `    <changefreq>${escapeXml(url.changefreq)}</changefreq>\n`;
    if (url.prioridade) bloco += `    <priority>${escapeXml(url.prioridade)}</priority>\n`;
    bloco += '  </url>';
    return bloco;
  });

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n' +
    linhas.join('\n') +
    '\n</urlset>'
  );
}

function montarUrlsNews(config, base, posts) {
  if (!sim(config, 'sitemap_news_ativo', false)) return [];

  const limite = new Date(Date.now() - LIMITE_NEWS_HORAS * 60 * 60 * 1000);
  const nomePublicacao = (config.site_nome || 'Site Gospel').trim();

  return posts
    .filter((post) => post.publicadoEm && new Date(post.publicadoEm) >= limite)
    .slice(0, LIMITE_NEWS_URLS)
    .map((post) => ({
      loc: `${base}/post/${post.slug}`,
      titulo: post.titulo,
      publicadoEm: post.publicadoEm,
      nomePublicacao
    }));
}

function renderizarNewsSitemap(urlsNews) {
  const linhas = urlsNews.map((item) =>
    '  <url>\n' +
    `    <loc>${escapeXml(item.loc)}</loc>\n` +
    '    <news:news>\n' +
    '      <news:publication>\n' +
    `        <news:name>${escapeXml(item.nomePublicacao)}</news:name>\n` +
    '        <news:language>pt</news:language>\n' +
    '      </news:publication>\n' +
    `      <news:publication_date>${escapeXml(formatarLastmod(item.publicadoEm))}</news:publication_date>\n` +
    `      <news:title>${escapeXml(item.titulo)}</news:title>\n` +
    '    </news:news>\n' +
    '  </url>'
  );

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n' +
    linhas.join('\n') +
    '\n</urlset>'
  );
}

function listarSitemaps(config, base) {
  const sitemaps = [{ loc: `${base}/sitemap.xml`, tipo: 'principal' }];
  if (sim(config, 'sitemap_news_ativo', false)) {
    sitemaps.push({ loc: `${base}/sitemap-news.xml`, tipo: 'google-news' });
  }
  return sitemaps;
}

async function obterResumo(config, req) {
  const base = obterBaseUrl(config, req);
  const dados = await carregarDados();
  const urls = montarUrls(config, base, dados);
  const urlsNews = montarUrlsNews(config, base, dados.posts);

  const contagem = {
    home: sim(config, 'sitemap_incluir_home', true) ? 1 : 0,
    posts: sim(config, 'sitemap_incluir_posts', true) ? dados.posts.length : 0,
    categorias: sim(config, 'sitemap_incluir_categorias', true) ? dados.categorias.length : 0,
    paginas: sim(config, 'sitemap_incluir_paginas', true) ? dados.paginas.length : 0,
    news: urlsNews.length,
    total: urls.length
  };

  return {
    base,
    urls,
    urlsNews,
    contagem,
    sitemaps: listarSitemaps(config, base),
    robotsUrl: `${base}/robots.txt`,
    googleSearchConsoleUrl: 'https://search.google.com/search-console',
    googleSitemapPingUrl: base ? `https://www.google.com/ping?sitemap=${encodeURIComponent(`${base}/sitemap.xml`)}` : null,
    indexar: sim(config, 'seo_indexar', true),
    amostra: urls.slice(0, 12).map((u) => u.loc)
  };
}

async function gerarSitemapPrincipal(config, req) {
  const base = obterBaseUrl(config, req);
  const dados = await carregarDados();
  const urls = montarUrls(config, base, dados);
  return renderizarUrlset(urls);
}

async function gerarSitemapNews(config, req) {
  const base = obterBaseUrl(config, req);
  const dados = await carregarDados();
  const urlsNews = montarUrlsNews(config, base, dados.posts);
  return renderizarNewsSitemap(urlsNews);
}

module.exports = {
  obterBaseUrl,
  obterResumo,
  gerarSitemapPrincipal,
  gerarSitemapNews,
  listarSitemaps
};
