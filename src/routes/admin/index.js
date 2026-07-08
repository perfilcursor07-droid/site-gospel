const router = require('express').Router();
const { autenticado } = require('../../middlewares/auth');
const { Post, Page, Category, User } = require('../../models');

router.use(autenticado);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const [totalPosts, totalPaginas, totalCategorias, totalUsuarios] = await Promise.all([
      Post.count(),
      Page.count(),
      Category.count(),
      User.count()
    ]);
    const ultimosPosts = await Post.findAll({
      include: ['autor', 'categoria'],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    res.render('admin/dashboard', {
      titulo: 'Dashboard',
      totalPosts,
      totalPaginas,
      totalCategorias,
      totalUsuarios,
      ultimosPosts
    });
  } catch (e) { next(e); }
});

router.use('/posts', require('./posts'));
router.use('/paginas', require('./pages'));
router.use('/categorias', require('./categories'));
router.use('/usuarios', require('./users'));
router.use('/configuracoes', require('./settings'));

module.exports = router;
