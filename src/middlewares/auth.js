function autenticado(req, res, next) {
  if (req.session.user) return next();
  req.flash('erro', 'Faça login para acessar o painel.');
  res.redirect('/login');
}

function permitir(...papeis) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('erro', 'Faça login para continuar.');
      return res.redirect('/login');
    }
    if (papeis.includes(req.session.user.papel)) return next();
    req.flash('erro', 'Você não tem permissão para acessar esta área.');
    res.redirect('/admin');
  };
}

module.exports = { autenticado, permitir };
