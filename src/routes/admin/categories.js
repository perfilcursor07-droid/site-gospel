const router = require('express').Router();
const { Category } = require('../../models');
const { permitir } = require('../../middlewares/auth');

router.use(permitir('administrador', 'gestor'));

router.get('/', async (req, res, next) => {
  try {
    const categorias = await Category.findAll({ order: [['nome', 'ASC']] });
    res.render('admin/categories/index', { titulo: 'Categorias', categorias });
  } catch (e) { next(e); }
});

router.get('/nova', (req, res) => {
  res.render('admin/categories/form', { titulo: 'Nova Categoria', categoria: null });
});

router.post('/', async (req, res) => {
  try {
    await Category.create({ nome: req.body.nome, descricao: req.body.descricao });
    req.flash('sucesso', 'Categoria criada com sucesso.');
    res.redirect('/admin/categorias');
  } catch (e) {
    req.flash('erro', 'Erro ao criar categoria: ' + e.message);
    res.redirect('/admin/categorias/nova');
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const categoria = await Category.findByPk(req.params.id);
    if (!categoria) {
      req.flash('erro', 'Categoria não encontrada.');
      return res.redirect('/admin/categorias');
    }
    res.render('admin/categories/form', { titulo: 'Editar Categoria', categoria });
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res) => {
  try {
    const categoria = await Category.findByPk(req.params.id);
    if (!categoria) {
      req.flash('erro', 'Categoria não encontrada.');
      return res.redirect('/admin/categorias');
    }
    categoria.nome = req.body.nome;
    categoria.descricao = req.body.descricao;
    await categoria.save();
    req.flash('sucesso', 'Categoria atualizada com sucesso.');
    res.redirect('/admin/categorias');
  } catch (e) {
    req.flash('erro', 'Erro ao atualizar categoria: ' + e.message);
    res.redirect('/admin/categorias');
  }
});

router.post('/:id/excluir', async (req, res) => {
  try {
    await Category.destroy({ where: { id: req.params.id } });
    req.flash('sucesso', 'Categoria excluída.');
  } catch (e) {
    req.flash('erro', 'Erro ao excluir categoria: ' + e.message);
  }
  res.redirect('/admin/categorias');
});

module.exports = router;
