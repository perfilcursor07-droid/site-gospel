const router = require('express').Router();
const { Op } = require('sequelize');
const { autenticado } = require('../../middlewares/auth');
const { Post, Page, Category, User } = require('../../models');

router.use(autenticado);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.adminPath = req.path;
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const [totalPosts, totalPublicados, totalRascunhos, totalPaginas, totalCategorias, totalUsuarios] = await Promise.all([
      Post.count(),
      Post.count({ where: { status: 'publicado' } }),
      Post.count({ where: { status: 'rascunho' } }),
      Page.count(),
      Category.count(),
      User.count()
    ]);

    // Posts por mês (últimos 6 meses) para o gráfico do dashboard
    const agora = new Date();
    const inicio = new Date(agora.getFullYear(), agora.getMonth() - 5, 1);
    const postsPeriodo = await Post.findAll({
      where: { createdAt: { [Op.gte]: inicio } },
      attributes: ['createdAt']
    });
    const postsPorMes = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      postsPorMes.push({
        ano: d.getFullYear(),
        mes: d.getMonth(),
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        total: 0
      });
    }
    postsPeriodo.forEach((p) => {
      const d = new Date(p.createdAt);
      const m = postsPorMes.find((x) => x.ano === d.getFullYear() && x.mes === d.getMonth());
      if (m) m.total += 1;
    });
    const maxPorMes = Math.max(...postsPorMes.map((m) => m.total), 1);

    const ultimosPosts = await Post.findAll({
      include: ['autor', 'categoria'],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    res.render('admin/dashboard', {
      titulo: 'Dashboard',
      totalPosts,
      totalPublicados,
      totalRascunhos,
      totalPaginas,
      totalCategorias,
      totalUsuarios,
      postsPorMes,
      maxPorMes,
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
