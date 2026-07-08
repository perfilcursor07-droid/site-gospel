require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');

const { sequelize, Category } = require('./models');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/site');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-este-segredo',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(flash());

app.use(async (req, res, next) => {
  res.locals.usuarioLogado = req.session.user || null;
  res.locals.mensagens = { sucesso: req.flash('sucesso'), erro: req.flash('erro') };
  try {
    res.locals.categoriasNav = await Category.findAll({ order: [['nome', 'ASC']] });
  } catch (e) {
    res.locals.categoriasNav = [];
  }
  next();
});

app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/public'));

app.use((req, res) => {
  res.status(404).render('site/404', { titulo: 'Página não encontrada' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('site/404', { titulo: 'Erro interno' });
});

const PORT = process.env.PORT || 3000;
sequelize.sync().then(() => {
  app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
}).catch((e) => {
  console.error('Erro ao conectar ao banco de dados:', e.message);
  process.exit(1);
});
