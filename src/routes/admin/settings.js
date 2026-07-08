const router = require('express').Router();
const { Setting } = require('../../models');
const { permitir } = require('../../middlewares/auth');
const upload = require('../../config/upload');

router.use(permitir('administrador'));

router.get('/', async (req, res, next) => {
  try {
    const config = await Setting.obterTodas();
    res.render('admin/settings/form', { titulo: 'Configurações', config });
  } catch (e) { next(e); }
});

router.post('/', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'og_imagem', maxCount: 1 }
]), async (req, res) => {
  try {
    const campos = [
      'site_nome',
      'site_descricao',
      'seo_titulo',
      'seo_descricao',
      'seo_palavras_chave',
      'google_site_verification',
      'google_analytics'
    ];
    for (const campo of campos) {
      if (campo in req.body) await Setting.definir(campo, (req.body[campo] || '').trim());
    }

    if (req.files && req.files.logo) {
      await Setting.definir('logo', `/uploads/${req.files.logo[0].filename}`);
    } else if (req.body.remover_logo === 'on') {
      await Setting.definir('logo', '');
    }

    if (req.files && req.files.og_imagem) {
      await Setting.definir('og_imagem', `/uploads/${req.files.og_imagem[0].filename}`);
    }

    req.flash('sucesso', 'Configurações salvas com sucesso.');
  } catch (e) {
    req.flash('erro', 'Erro ao salvar configurações: ' + e.message);
  }
  res.redirect('/admin/configuracoes');
});

module.exports = router;
