const router = require('express').Router();
const { Page } = require('../../models');
const { permitir } = require('../../middlewares/auth');

router.use(permitir('administrador', 'gestor'));

router.get('/', async (req, res, next) => {
  try {
    const paginas = await Page.findAll({ order: [['titulo', 'ASC']] });
    res.render('admin/pages/index', { titulo: 'Páginas', paginas });
  } catch (e) { next(e); }
});

router.get('/nova', (req, res) => {
  res.render('admin/pages/form', { titulo: 'Nova Página', pagina: null });
});

router.post('/', async (req, res) => {
  try {
    await Page.create({
      titulo: req.body.titulo,
      conteudo: req.body.conteudo,
      status: req.body.status || 'publicado'
    });
    req.flash('sucesso', 'Página criada com sucesso.');
    res.redirect('/admin/paginas');
  } catch (e) {
    req.flash('erro', 'Erro ao criar página: ' + e.message);
    res.redirect('/admin/paginas/nova');
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const pagina = await Page.findByPk(req.params.id);
    if (!pagina) {
      req.flash('erro', 'Página não encontrada.');
      return res.redirect('/admin/paginas');
    }
    res.render('admin/pages/form', { titulo: 'Editar Página', pagina });
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res) => {
  try {
    const pagina = await Page.findByPk(req.params.id);
    if (!pagina) {
      req.flash('erro', 'Página não encontrada.');
      return res.redirect('/admin/paginas');
    }
    pagina.titulo = req.body.titulo;
    pagina.conteudo = req.body.conteudo;
    pagina.status = req.body.status || 'publicado';
    await pagina.save();
    req.flash('sucesso', 'Página atualizada com sucesso.');
    res.redirect('/admin/paginas');
  } catch (e) {
    req.flash('erro', 'Erro ao atualizar página: ' + e.message);
    res.redirect('/admin/paginas');
  }
});

router.post('/:id/excluir', async (req, res) => {
  try {
    await Page.destroy({ where: { id: req.params.id } });
    req.flash('sucesso', 'Página excluída.');
  } catch (e) {
    req.flash('erro', 'Erro ao excluir página: ' + e.message);
  }
  res.redirect('/admin/paginas');
});

module.exports = router;
