const router = require('express').Router();
const { User } = require('../../models');
const { permitir } = require('../../middlewares/auth');

router.use(permitir('administrador'));

router.get('/', async (req, res, next) => {
  try {
    const usuarios = await User.findAll({ order: [['nome', 'ASC']] });
    res.render('admin/users/index', { titulo: 'Usuários', usuarios });
  } catch (e) { next(e); }
});

router.get('/novo', (req, res) => {
  res.render('admin/users/form', { titulo: 'Novo Usuário', usuario: null });
});

router.post('/', async (req, res) => {
  try {
    await User.create({
      nome: req.body.nome,
      email: req.body.email,
      senha: req.body.senha,
      papel: req.body.papel || 'usuario'
    });
    req.flash('sucesso', 'Usuário criado com sucesso.');
    res.redirect('/admin/usuarios');
  } catch (e) {
    req.flash('erro', 'Erro ao criar usuário: ' + e.message);
    res.redirect('/admin/usuarios/novo');
  }
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const usuario = await User.findByPk(req.params.id);
    if (!usuario) {
      req.flash('erro', 'Usuário não encontrado.');
      return res.redirect('/admin/usuarios');
    }
    res.render('admin/users/form', { titulo: 'Editar Usuário', usuario });
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res) => {
  try {
    const usuario = await User.findByPk(req.params.id);
    if (!usuario) {
      req.flash('erro', 'Usuário não encontrado.');
      return res.redirect('/admin/usuarios');
    }
    usuario.nome = req.body.nome;
    usuario.email = req.body.email;
    usuario.papel = req.body.papel || usuario.papel;
    if (req.body.senha) usuario.senha = req.body.senha;
    await usuario.save();
    req.flash('sucesso', 'Usuário atualizado com sucesso.');
    res.redirect('/admin/usuarios');
  } catch (e) {
    req.flash('erro', 'Erro ao atualizar usuário: ' + e.message);
    res.redirect('/admin/usuarios');
  }
});

router.post('/:id/excluir', async (req, res) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      req.flash('erro', 'Você não pode excluir o seu próprio usuário.');
      return res.redirect('/admin/usuarios');
    }
    await User.destroy({ where: { id: req.params.id } });
    req.flash('sucesso', 'Usuário excluído.');
  } catch (e) {
    req.flash('erro', 'Erro ao excluir usuário: ' + e.message);
  }
  res.redirect('/admin/usuarios');
});

module.exports = router;
