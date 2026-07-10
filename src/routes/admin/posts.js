const router = require('express').Router();
const { Post, Category, Setting } = require('../../models');
const uploadCapaPost = require('../../middlewares/uploadCapaPost');
const { buscarCandidatosCapaManual, salvarCandidatoComoCapa } = require('../../services/imageFetcher');
const { braveDisponivel } = require('../../services/braveApi');
const { obterResumoFila, listarErrosRecentesFila } = require('../../services/iaFilaPublicacao');
const { obterResumoMonitores } = require('../../services/iaMonitorAutomatico');
const { notificarPublicacao } = require('../../services/indexacao');

router.use('/ia', require('./aiPosts'));

function podeEditar(user, post) {
  if (!user || !post) return false;
  if (['administrador', 'gestor'].includes(user.papel)) return true;
  return Number(post.autorId) === Number(user.id);
}

function redirectPosts(res, status) {
  const filtro = status && status !== 'todos' ? `?status=${encodeURIComponent(status)}` : '';
  res.redirect(`/admin/posts${filtro}`);
}

async function avisarGoogleSePublicado(post, req, eraPublicado = false) {
  if (!post || post.status !== 'publicado' || eraPublicado) return;
  try {
    const config = await Setting.obterTodas();
    await notificarPublicacao(config, post.slug, req);
  } catch (e) {
    console.warn('avisarGoogleSePublicado:', e.message);
  }
}

router.get('/', async (req, res, next) => {
  try {
    const where = req.session.user.papel === 'usuario' ? { autorId: req.session.user.id } : {};
    const [posts, filaIa, monitorIa, filaErrosRecentes] = await Promise.all([
      Post.findAll({ where, include: ['categoria', 'autor'], order: [['createdAt', 'DESC']] }),
      obterResumoFila(req.session.user.papel === 'usuario' ? req.session.user.id : null),
      obterResumoMonitores(req.session.user.id),
      listarErrosRecentesFila(req.session.user.papel === 'usuario' ? req.session.user.id : null, 5)
    ]);
    res.render('admin/posts/index', { titulo: 'Posts', posts, filaIa, monitorIa, filaErrosRecentes });
  } catch (e) { next(e); }
});

router.get('/novo', async (req, res, next) => {
  try {
    const categorias = await Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] });
    res.render('admin/posts/form', { titulo: 'Novo Post', post: null, categorias });
  } catch (e) { next(e); }
});

router.post('/buscar-imagens', async (req, res) => {
  try {
    const { titulo, resumo, termos, assuntoImagem } = req.body;
    if (!titulo && !termos) {
      return res.status(400).json({ ok: false, erro: 'Informe o título da matéria ou termos de busca.' });
    }
    const candidatos = await buscarCandidatosCapaManual({
      titulo: titulo || '',
      resumo: resumo || '',
      termosBusca: termos || '',
      assuntoImagem: assuntoImagem || ''
    });

    let mensagem;
    if (!candidatos.length) {
      const focoPessoa = /\b(?:cantor(?:a)?|pastor(?:a)?)\s+\w/i.test(termos || '');
      const temBusca = !!process.env.SERPER_API_KEY || braveDisponivel();
      mensagem = temBusca
        ? (focoPessoa
          ? 'Nenhuma foto dessa pessoa encontrada. Tente só o nome (ex.: Midian Lima) ou variações da grafia.'
          : 'Nenhuma imagem relevante. Tente o nome da igreja, cidade ou evento (ex.: Aliança em Cristo Santo André).')
        : 'Nenhuma imagem encontrada. Configure SERPER_API_KEY (serper.dev — 2500 buscas grátis) ou BRAVE_SEARCH_API_KEY no servidor.';
    } else {
      mensagem = `${candidatos.length} imagem(ns) relevante(s). Clique para usar como capa.`;
    }

    res.json({
      ok: true,
      candidatos,
      mensagem
    });
  } catch (e) {
    console.error('buscar-imagens:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/vincular-imagem', async (req, res) => {
  try {
    const { url, preview, source, titulo, resumo, assuntoImagem, alt } = req.body;
    if ((!url && !preview) || (url && typeof url !== 'string') || (preview && typeof preview !== 'string')) {
      return res.status(400).json({ ok: false, erro: 'URL da imagem obrigatória.' });
    }
    const resultado = await salvarCandidatoComoCapa({
      url: url || preview,
      preview: preview || url,
      contextLink: source || '',
      titulo: titulo || '',
      resumo: resumo || '',
      assuntoImagem: assuntoImagem || '',
      alt: alt || ''
    });
    if (!resultado) {
      return res.status(400).json({
        ok: false,
        erro: 'Não foi possível baixar esta imagem. Tente outra ou faça upload manual.'
      });
    }
    res.json({ ok: true, ...resultado });
  } catch (e) {
    console.error('vincular-imagem:', e);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/', ...uploadCapaPost, async (req, res) => {
  try {
    const ehUsuario = req.session.user.papel === 'usuario';
    let imagem = req.file ? `/uploads/${req.file.filename}` : null;
    if (!imagem && req.body.imagem_ia_url && req.body.imagem_ia_url.startsWith('/uploads/')) {
      imagem = req.body.imagem_ia_url;
    }
    let status = ehUsuario ? 'rascunho' : (req.body.status || 'rascunho');
    if (status === 'publicado' && !imagem) status = 'rascunho';
    const post = await Post.create({
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
    await avisarGoogleSePublicado(post, req);
    req.flash('sucesso', (!ehUsuario && req.body.status === 'publicado' && !imagem)
      ? 'Post salvo como rascunho (sem imagem de capa).'
      : 'Post criado com sucesso.');
    res.redirect('/admin/posts');
  } catch (e) {
    req.flash('erro', 'Erro ao criar post: ' + e.message);
    res.redirect('/admin/posts/novo');
  }
});

router.post('/excluir-lote', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids
      : (req.body.ids ? [req.body.ids] : []);
    const numeros = [...new Set(ids.map((id) => parseInt(id, 10)).filter((id) => id > 0))];

    if (!numeros.length) {
      req.flash('erro', 'Nenhum post selecionado.');
      return redirectPosts(res, req.body.redirectStatus);
    }

    const posts = await Post.findAll({ where: { id: numeros } });
    let excluidos = 0;

    for (const post of posts) {
      if (!podeEditar(req.session.user, post)) continue;
      await post.destroy();
      excluidos++;
    }

    if (!excluidos) {
      req.flash('erro', 'Nenhum post pôde ser excluído (sem permissão).');
    } else {
      req.flash('sucesso', excluidos === 1 ? '1 post excluído.' : `${excluidos} posts excluídos.`);
    }
  } catch (e) {
    req.flash('erro', 'Erro ao excluir posts: ' + e.message);
  }
  redirectPosts(res, req.body.redirectStatus);
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const post = id ? await Post.findByPk(id) : null;
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return res.redirect('/admin/posts');
    }
    const categorias = await Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] });
    res.render('admin/posts/form', { titulo: 'Editar Post', post, categorias });
  } catch (e) { next(e); }
});

router.post('/:id/excluir', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const post = id ? await Post.findByPk(id) : null;
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return redirectPosts(res, req.body.redirectStatus);
    }
    await post.destroy();
    req.flash('sucesso', 'Post excluído.');
  } catch (e) {
    req.flash('erro', 'Erro ao excluir post: ' + e.message);
  }
  redirectPosts(res, req.body.redirectStatus);
});

router.post('/:id', ...uploadCapaPost, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const post = id ? await Post.findByPk(id) : null;
    if (!post || !podeEditar(req.session.user, post)) {
      req.flash('erro', 'Post não encontrado ou sem permissão.');
      return res.redirect('/admin/posts');
    }
    const ehUsuario = req.session.user.papel === 'usuario';
    const eraPublicado = post.status === 'publicado';
    post.titulo = req.body.titulo;
    post.slug = (req.body.slug || '').trim();
    post.resumo = req.body.resumo;
    post.conteudo = req.body.conteudo;
    post.categoriaId = req.body.categoriaId || null;
    post.metaTitle = (req.body.meta_title || '').trim() || null;
    post.metaDescription = (req.body.meta_description || '').trim() || null;
    if (req.file) post.imagem = `/uploads/${req.file.filename}`;
    else if (req.body.imagem_ia_url && req.body.imagem_ia_url.startsWith('/uploads/')) {
      post.imagem = req.body.imagem_ia_url;
    }
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
    await avisarGoogleSePublicado(post, req, eraPublicado);
    req.flash('sucesso', (!ehUsuario && req.body.status === 'publicado' && !post.imagem)
      ? 'Post salvo como rascunho (sem imagem de capa).'
      : 'Post atualizado com sucesso.');
    res.redirect('/admin/posts');
  } catch (e) {
    req.flash('erro', 'Erro ao atualizar post: ' + e.message);
    res.redirect('/admin/posts');
  }
});

module.exports = router;
