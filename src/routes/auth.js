const router = require('express').Router();
const { User } = require('../models');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('auth/login', { layout: false, titulo: 'Login' });
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user || !(await user.verificarSenha(senha))) {
      req.flash('erro', 'E-mail ou senha inválidos.');
      return res.redirect('/login');
    }
    req.session.user = { id: user.id, nome: user.nome, email: user.email, papel: user.papel };
    res.redirect('/admin');
  } catch (e) {
    req.flash('erro', 'Erro ao efetuar login.');
    res.redirect('/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
