const router = require('express').Router();
const { Post, Category } = require('../../models');
const upload = require('../../config/upload');

router.use('/ia', require('./aiPosts'));

function podeEditar(user, post) {
  return ['administrador', 'gestor'].includes(user.papel) || post.autorId === user.id;
}

router.get('/', async (req, res, next) => {
  try {
    const where = req.session.user.papel === 'usuario' ? { autorId: req.session.user.id } : {};
    const posts = await Post.findAll({ where, include: ['categoria', 'autor'], order: [['createdAt', 'DESC']] });
    res.render('admin/posts/index', { titulo: 'Posts', posts });
  } catch (e) { next(e); }
});

router.get('/novo', async (req, res, next) => {
  try {
    const categorias = await Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] });
    res.render('admin/posts/form', { titulo: 'Novo Post', post: null, categorias });
  } catch (e) { next(e); }
});

router.post('/', upload.single('imagem'), async (req, res) => {
  try {
    const ehUsuario = req.session.user.papel === 'usuario';
    let imagem = req.file ? `/uploads/${req.file.filename}` : null;
    if (!imagem && req.body.imagem_ia_url && req.body.imagem_ia_url.startsWith('/uploads/')) {
      imagem = req.body.imagem_ia_url;
    }
    let status = ehUsuario ? 'rascunho' : (req.body.status || 'rascunho');
    if (status === 'publicado' && !imagem) status = 'rascunho';
    await Post.create({
      titulo: req.body.titulo,
      slug: (req.body.slug || '').trim(),
      resumo: req.body.resumo,
      conteudo: req.body.conteudo,
      categoriaId: req.body.categoriaId || null,
      autorId: req.session.user.id,
      status,
      destaque: ehUsuario ? false : req.body.destaque === 'on',
      metaTitle: (req.body.meta_title || '').trim() || null,
      metaDescription: (req.body.meta_description || '').trim() || null,
      imagem,
      imagemAlt: (req.body.imagem_alt || '').trim() || null
    });
    req.flash('sucesso', (!ehUsuario && req.body.status === 'publicado' && !imagem)
      ? 'Post salvo como rascunho (sem imagem de capa).'
      : 'Post criado com sucesso.');
    res.redirect('/admin/posts');
  } catch (e) {
    req.flash('erro', 'Erro ao criar post: ' + e.message);
    res.redirect('/admin/posts/novo');
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return res.redirect('/admin/posts');
    }
    const categorias = await Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] });
    res.render('admin/posts/form', { titulo: 'Editar Post', post, categorias });
  } catch (e) { next(e); }
});

router.post('/:id', upload.single('imagem'), async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return res.redirect('/admin/posts');
    }
    const ehUsuario = req.session.user.papel === 'usuario';
    post.titulo = req.body.titulo;
    post.slug = (req.body.slug || '').trim();
    post.resumo = req.body.resumo;
    post.conteudo = req.body.conteudo;
    post.categoriaId = req.body.categoriaId || null;
    post.metaTitle = (req.body.meta_title || '').trim() || null;
    post.metaDescription = (req.body.meta_description || '').trim() || null;
    if (req.file) post.imagem = `/uploads/${req.file.filename}`;
    if (req.body.imagem_alt !== undefined) {
      post.imagemAlt = (req.body.imagem_alt || '').trim() || null;
    }
    if (!ehUsuario) {
      let status = req.body.status || 'rascunho';
      if (status === 'publicado' && !post.imagem) status = 'rascunho';
      post.status = status;
      post.destaque = req.body.destaque === 'on';
    }
    await post.save();
    req.flash('sucesso', (!ehUsuario && req.body.status === 'publicado' && !post.imagem)
      ? 'Post salvo como rascunho (sem imagem de capa).'
      : 'Post atualizado com sucesso.');
    res.redirect('/admin/posts');
  } catch (e) {
    req.flash('erro', 'Erro ao atualizar post: ' + e.message);
    res.redirect('/admin/posts');
  }
});

router.post('/:id/excluir', async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return res.redirect('/admin/posts');
    }
    await post.destroy();
    req.flash('sucesso', 'Post excluído.');
  } catch (e) {
    req.flash('erro', 'Erro ao excluir post: ' + e.message);
  }
  res.redirect('/admin/posts');
});

module.exports = router;
