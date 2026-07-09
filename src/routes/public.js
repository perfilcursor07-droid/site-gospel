const router = require('express').Router();
const { Op } = require('sequelize');
const { Post, Page, Category, Comment } = require('../models');
const { dividirConteudoParaLeiaMais } = require('../utils/postContent');
const { gerarCaptcha, validarCaptcha } = require('../utils/commentCaptcha');
const { buscarHibrida } = require('../services/braveSearch');
const { braveDisponivel } = require('../services/braveApi');

const includePadrao = ['categoria', 'autor'];

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get('/', async (req, res, next) => {
  try {
    const recentes = await Post.findAll({
      where: { status: 'publicado' },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']],
      limit: 10
    });

    const principal = recentes[0] || null;
    const laterais = recentes.slice(1, 4); // 2ª a 4ª matéria
    const ultimasPublicacoes = recentes.slice(4); // 5ª em diante

    res.render('site/home', { titulo: 'Início', principal, laterais, publicacoes: recentes, ultimasPublicacoes });
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
    const [relacionados, leiaMais] = await Promise.all([
      post.categoriaId
        ? Post.findAll({
            where: { categoriaId: post.categoriaId, status: 'publicado', id: { [Op.ne]: post.id } },
            include: includePadrao,
            order: [['publicadoEm', 'DESC']],
            limit: 6
          })
        : Post.findAll({
            where: { status: 'publicado', id: { [Op.ne]: post.id } },
            include: includePadrao,
            order: [['publicadoEm', 'DESC']],
            limit: 6
          }),
      Post.findAll({
        where: { status: 'publicado', id: { [Op.ne]: post.id } },
        include: includePadrao,
        order: [['publicadoEm', 'DESC']],
        limit: 3
      })
    ]);

    const conteudoPartes = dividirConteudoParaLeiaMais(post.conteudo);

    const comentarios = await Comment.findAll({
      where: { postId: post.id, status: 'aprovado' },
      order: [['createdAt', 'ASC']]
    });

    const captcha = gerarCaptcha();
    req.session.commentCaptcha = {
      postId: post.id,
      pergunta: captcha.pergunta,
      resposta: captcha.resposta
    };

    res.render('site/post', {
      titulo: post.titulo,
      metaDescricao: post.metaDescription || post.resumo || null,
      artigo: post,
      post,
      relacionados,
      leiaMais,
      conteudoPartes,
      comentarios,
      captchaPergunta: captcha.pergunta
    });
  } catch (e) { next(e); }
});

router.post('/post/:slug/comentario', async (req, res) => {
  const slug = req.params.slug;
  try {
    const post = await Post.findOne({ where: { slug, status: 'publicado' } });
    if (!post) {
      req.flash('erro', 'Matéria não encontrada.');
      return res.redirect('/');
    }

    if (req.body.website) {
      return res.redirect(`/post/${slug}#comentarios`);
    }

    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const conteudo = (req.body.conteudo || '').trim();
    const respostaCaptcha = req.body.resposta_captcha;

    if (nome.length < 2 || nome.length > 80) {
      req.flash('erro', 'Informe seu nome (mínimo 2 caracteres).');
      return res.redirect(`/post/${slug}#comentarios`);
    }
    if (!emailValido(email)) {
      req.flash('erro', 'Informe um e-mail válido.');
      return res.redirect(`/post/${slug}#comentarios`);
    }
    if (conteudo.length < 5 || conteudo.length > 2000) {
      req.flash('erro', 'O comentário deve ter entre 5 e 2000 caracteres.');
      return res.redirect(`/post/${slug}#comentarios`);
    }
    if (!validarCaptcha(req.session.commentCaptcha, post.id, respostaCaptcha)) {
      req.flash('erro', 'Resposta de segurança incorreta. Tente novamente.');
      return res.redirect(`/post/${slug}#comentarios`);
    }

    await Comment.create({
      postId: post.id,
      nome,
      email,
      conteudo,
      status: 'aprovado'
    });

    delete req.session.commentCaptcha;
    req.flash('sucesso', 'Comentário publicado com sucesso!');
    res.redirect(`/post/${slug}#comentarios`);
  } catch (e) {
    req.flash('erro', 'Não foi possível enviar o comentário. Tente novamente.');
    res.redirect(`/post/${slug}#comentarios`);
  }
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
              { resumo: { [Op.like]: `%${q}%` } },
              { conteudo: { [Op.like]: `%${q}%` } }
            ]
          },
          include: includePadrao,
          order: [['publicadoEm', 'DESC']],
          limit: 20
        })
      : [];

    let buscaWeb = { noticias: [], web: [] };
    if (q && q.length >= 2 && braveDisponivel()) {
      try {
        buscaWeb = await buscarHibrida(q);
      } catch (e) {
        console.warn('buscarHibrida:', e.message);
      }
    }

    res.render('site/busca', {
      titulo: 'Busca',
      posts,
      q,
      noticiasWeb: buscaWeb.noticias,
      resultadosWeb: buscaWeb.web,
      buscaBraveAtiva: braveDisponivel()
    });
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
