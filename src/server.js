require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');

const { sequelize, Category, Page, Setting } = require('./models');
const { obterUrlBase } = require('./utils/requestUrl');
const { tickFila, recuperarJobsTravados } = require('./services/iaFilaPublicacao');

const app = express();
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/site');

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));
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
    const [categorias, paginas, config] = await Promise.all([
      Category.findAll({ order: [['ordem', 'ASC'], ['nome', 'ASC']] }),
      Page.findAll({ where: { status: 'publicado' }, order: [['titulo', 'ASC']] }),
      Setting.obterTodas()
    ]);
    res.locals.categoriasNav = categorias;
    res.locals.paginasNav = paginas;
    res.locals.config = config;
    res.locals.urlBase = obterUrlBase(req, config);
    res.locals.urlAtual = res.locals.urlBase + req.originalUrl.split('?')[0];
  } catch (e) {
    res.locals.categoriasNav = [];
    res.locals.paginasNav = [];
    res.locals.config = {};
    res.locals.urlBase = obterUrlBase(req, {});
    res.locals.urlAtual = res.locals.urlBase + req.originalUrl.split('?')[0];
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

async function iniciarWorkerFila() {
  let nomeSite = 'Site Gospel';
  try {
    const config = await Setting.obterTodas();
    nomeSite = config.site_nome || nomeSite;
  } catch { /* ignore */ }

  await recuperarJobsTravados();

  setInterval(() => {
    tickFila(nomeSite).catch((e) => console.warn('iaFila:', e.message));
  }, 30000);

  tickFila(nomeSite).catch(() => {});
}

sequelize.authenticate().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    iniciarWorkerFila();
  });
}).catch((e) => {
  console.error('Erro ao conectar ao banco de dados:', e.message);
  console.error('Verifique o arquivo .env e rode: npm run db:migrate');
  process.exit(1);
});
