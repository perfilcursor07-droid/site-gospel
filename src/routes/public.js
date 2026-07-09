const router = require('express').Router();
const { Op } = require('sequelize');
const { Post, Page, Category, Comment } = require('../models');
const { dividirConteudoParaLeiaMais } = require('../utils/postContent');
const { gerarCaptcha, validarCaptcha } = require('../utils/commentCaptcha');
const { buscarHibrida } = require('../services/braveSearch');
const { braveDisponivel } = require('../services/braveApi');
const {
  gerarSitemapPrincipal,
  gerarSitemapNews,
  listarSitemaps,
  obterBaseUrl
} = require('../services/sitemap');
const {
  ampAtivo,
  escapeHtml,
  urlAbsoluta,
  sanitizarConteudoAmp,
  urlAmpPost,
  obterTamanhoLogoAmp
} = require('../utils/amp');
const { obterUrlBase } = require('../utils/requestUrl');

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

router.get('/post/:slug/amp', async (req, res, next) => {
  try {
    const config = res.locals.config || {};
    if (!ampAtivo(config)) return next();

    const post = await Post.findOne({
      where: { slug: req.params.slug, status: 'publicado' },
      include: includePadrao
    });
    if (!post) return next();

    const base = obterUrlBase(req, config);
    const urlCanonica = `${base}/post/${post.slug}`;
    const nomeSite = config.site_nome || 'Site Gospel';
    const corPrimaria = config.cor_primaria || '#ea580c';
    const tituloSeo = post.metaTitle || post.titulo;
    const metaDescricao = post.metaDescription || post.resumo || config.seo_descricao || '';
    const adsenseClient = (config.google_adsense_client || '').trim()
      || (config.google_adsense || '').match(/ca-pub-\d+/i)?.[0]
      || '';
    const logoAmp = obterTamanhoLogoAmp(config);

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.titulo,
      description: metaDescricao,
      image: post.imagem ? [urlAbsoluta(base, post.imagem)] : undefined,
      datePublished: post.publicadoEm ? new Date(post.publicadoEm).toISOString() : undefined,
      dateModified: new Date(post.updatedAt).toISOString(),
      author: { '@type': 'Person', name: post.autor ? post.autor.nome : nomeSite },
      publisher: {
        '@type': 'Organization',
        name: nomeSite,
        logo: config.logo ? { '@type': 'ImageObject', url: urlAbsoluta(base, config.logo) } : undefined
      },
      mainEntityOfPage: urlCanonica
    });

    res.render('site/post-amp', {
      layout: false,
      post,
      nomeSite,
      corPrimaria,
      tituloSeo,
      metaDescricao,
      urlBase: base,
      urlCanonica,
      imagemAbsoluta: post.imagem ? urlAbsoluta(base, post.imagem) : '',
      logoAbsoluta: config.logo ? urlAbsoluta(base, config.logo) : '',
      logoAmp,
      conteudoAmp: sanitizarConteudoAmp(post.conteudo, base),
      adsenseClient: (config.amp_adsense || 'sim') !== 'nao' ? adsenseClient : '',
      escapeHtml,
      jsonLd
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

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const config = res.locals.config || {};
    if ((config.seo_indexar || 'sim') === 'nao') {
      return res.status(404).type('text/plain').send('Sitemap indisponível');
    }
    const xml = await gerarSitemapPrincipal(config, req);
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (e) { next(e); }
});

router.get('/sitemap-news.xml', async (req, res, next) => {
  try {
    const config = res.locals.config || {};
    if ((config.seo_indexar || 'sim') === 'nao' || (config.sitemap_news_ativo || 'nao') !== 'sim') {
      return res.status(404).type('text/plain').send('Sitemap News indisponível');
    }
    const xml = await gerarSitemapNews(config, req);
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (e) { next(e); }
});

router.get('/robots.txt', (req, res) => {
  const config = res.locals.config || {};
  const base = obterBaseUrl(config, req);
  const indexar = (config.seo_indexar || 'sim') !== 'nao';
  if (!indexar) {
    return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  }
  const linhasSitemap = listarSitemaps(config, base)
    .map((item) => `Sitemap: ${item.loc}`)
    .join('\n');
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /login\n' +
    'Disallow: /busca\n\n' +
    `${linhasSitemap}\n`
  );
});

module.exports = router;
