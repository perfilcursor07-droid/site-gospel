const router = require('express').Router();
const { Op } = require('sequelize');
const { Post, Page, Category } = require('../models');

const includePadrao = ['categoria', 'autor'];

router.get('/', async (req, res, next) => {
  try {
    const destaques = await Post.findAll({
      where: { status: 'publicado', destaque: true },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']],
      limit: 5
    });
    const recentes = await Post.findAll({
      where: { status: 'publicado' },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']],
      limit: 10
    });
    res.render('site/home', { titulo: 'Início', destaques, recentes });
  } catch (e) { next(e); }
});

router.get('/categoria/:slug', async (req, res, next) => {
  try {
    const categoria = await Category.findOne({ where: { slug: req.params.slug } });
    if (!categoria) return next();
    const posts = await Post.findAll({
      where: { categoriaId: categoria.id, status: 'publicado' },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']]
    });
    res.render('site/categoria', {
      titulo: categoria.nome,
      metaDescricao: categoria.descricao || null,
      categoria,
      posts
    });
  } catch (e) { next(e); }
});

router.get('/post/:slug', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { slug: req.params.slug, status: 'publicado' },
      include: includePadrao
    });
    if (!post) return next();
    res.render('site/post', {
      titulo: post.titulo,
      metaDescricao: post.resumo || null,
      artigo: post,
      post
    });
  } catch (e) { next(e); }
});

router.get('/pagina/:slug', async (req, res, next) => {
  try {
    const pagina = await Page.findOne({ where: { slug: req.params.slug, status: 'publicado' } });
    if (!pagina) return next();
    res.render('site/pagina', { titulo: pagina.titulo, pagina });
  } catch (e) { next(e); }
});

router.get('/busca', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const posts = q
      ? await Post.findAll({
          where: {
            status: 'publicado',
            [Op.or]: [
              { titulo: { [Op.like]: `%${q}%` } },
              { conteudo: { [Op.like]: `%${q}%` } }
            ]
          },
          include: includePadrao,
          order: [['publicadoEm', 'DESC']]
        })
      : [];
    res.render('site/busca', { titulo: 'Busca', posts, q });
  } catch (e) { next(e); }
});

// Sitemap dinâmico para o Google
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const [posts, paginas, categorias] = await Promise.all([
      Post.findAll({ where: { status: 'publicado' }, order: [['publicadoEm', 'DESC']] }),
      Page.findAll({ where: { status: 'publicado' } }),
      Category.findAll()
    ]);

    const urls = [{ loc: `${base}/`, prioridade: '1.0' }];
    posts.forEach((p) => urls.push({
      loc: `${base}/post/${p.slug}`,
      lastmod: new Date(p.updatedAt).toISOString().slice(0, 10),
      prioridade: '0.8'
    }));
    categorias.forEach((c) => urls.push({ loc: `${base}/categoria/${c.slug}`, prioridade: '0.6' }));
    paginas.forEach((p) => urls.push({
      loc: `${base}/pagina/${p.slug}`,
      lastmod: new Date(p.updatedAt).toISOString().slice(0, 10),
      prioridade: '0.5'
    }));

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) =>
        '  <url>\n' +
        `    <loc>${u.loc}</loc>\n` +
        (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
        `    <priority>${u.prioridade}</priority>\n` +
        '  </url>'
      ).join('\n') +
      '\n</urlset>';

    res.type('application/xml').send(xml);
  } catch (e) { next(e); }
});

// Robots.txt
router.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /login\n\n' +
    `Sitemap: ${base}/sitemap.xml\n`
  );
});

module.exports = router;
