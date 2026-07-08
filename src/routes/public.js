const router = require('express').Router();
const { Op } = require('sequelize');
const { Post, Page, Category } = require('../models');

const includePadrao = ['categoria', 'autor'];

router.get('/', async (req, res, next) => {
  try {
    const [destaques, recentes, categorias] = await Promise.all([
      Post.findAll({
        where: { status: 'publicado', destaque: true },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 5
      }),
      Post.findAll({
        where: { status: 'publicado' },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 10
      }),
      Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] })
    ]);

    // Blocos editoriais por categoria (apenas categorias com posts)
    const blocosCategorias = [];
    for (const categoria of categorias) {
      const posts = await Post.findAll({
        where: { categoriaId: categoria.id, status: 'publicado' },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 4
      });
      if (posts.length) blocosCategorias.push({ categoria, posts });
    }

    res.render('site/home', { titulo: 'Início', destaques, recentes, blocosCategorias });
  } catch (e) { next(e); }
});

router.get('/categoria/:slug', async (req, res, next) => {
  try {
    const categoria = await Category.findOne({ where: { slug: req.params.slug } });
    if (!categoria) return next();
    const porPagina = 12;
    const paginaAtual = Math.max(parseInt(req.query.pagina, 10) || 1, 1);
    const { rows: posts, count: total } = await Post.findAndCountAll({
      where: { categoriaId: categoria.id, status: 'publicado' },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']],
      limit: porPagina,
      offset: (paginaAtual - 1) * porPagina
    });
    res.render('site/categoria', {
      titulo: categoria.nome,
      metaDescricao: categoria.descricao || null,
      categoria,
      posts,
      paginaAtual,
      totalPaginas: Math.max(Math.ceil(total / porPagina), 1)
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
    const [relacionados, leiaMais, ultimas] = await Promise.all([
      post.categoriaId
        ? Post.findAll({
            where: { categoriaId: post.categoriaId, status: 'publicado', id: { [Op.ne]: post.id } },
            include: includePadrao,
            order: [['publicadoEm', 'DESC']],
            limit: 4
          })
        : [],
      Post.findAll({
        where: { status: 'publicado', id: { [Op.ne]: post.id } },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 6
      }),
      Post.findAll({
        where: { status: 'publicado', id: { [Op.ne]: post.id } },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 8
      })
    ]);
    res.render('site/post', {
      titulo: post.titulo,
      metaDescricao: post.metaDescription || post.resumo || null,
      artigo: post,
      post,
      relacionados,
      leiaMais,
      ultimas
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

// Robots.txt — respeita o toggle "indexar no Google" das configurações
router.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const indexar = (res.locals.config.seo_indexar || 'sim') !== 'nao';
  if (!indexar) {
    return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  }
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /login\n\n' +
    `Sitemap: ${base}/sitemap.xml\n`
  );
});

module.exports = router;
