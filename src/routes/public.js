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
      limit: 3
    });
    const recentes = await Post.findAll({
      where: { status: 'publicado' },
      include: includePadrao,
      order: [['publicadoEm', 'DESC']],
      limit: 9
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
    res.render('site/categoria', { titulo: categoria.nome, categoria, posts });
  } catch (e) { next(e); }
});

router.get('/post/:slug', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { slug: req.params.slug, status: 'publicado' },
      include: includePadrao
    });
    if (!post) return next();
    res.render('site/post', { titulo: post.titulo, post });
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

module.exports = router;
