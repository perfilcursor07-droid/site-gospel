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
  { name: 'favicon', maxCount: 1 },
  { name: 'og_imagem', maxCount: 1 }
]), async (req, res) => {
  try {
    const campos = [
      'site_nome',
      'site_slogan',
      'site_descricao',
      'cor_primaria',
      'seo_titulo',
      'seo_descricao',
      'seo_palavras_chave',
      'social_facebook',
      'social_instagram',
      'social_youtube',
      'social_whatsapp',
      'google_site_verification',
      'google_analytics',
      'head_custom',
      'footer_copyright',
      'footer_links'
    ];
    for (const campo of campos) {
      if (campo in req.body) await Setting.definir(campo, (req.body[campo] || '').trim());
    }

    // Toggle de indexação: quando desligado, aplica noindex + bloqueia no robots.txt
    await Setting.definir('seo_indexar', req.body.seo_indexar === 'on' ? 'sim' : 'nao');

    if (req.files && req.files.logo) {
      await Setting.definir('logo', `/uploads/${req.files.logo[0].filename}`);
    } else if (req.body.remover_logo === 'on') {
      await Setting.definir('logo', '');
    }

    if (req.files && req.files.favicon) {
      await Setting.definir('favicon', `/uploads/${req.files.favicon[0].filename}`);
    } else if (req.body.remover_favicon === 'on') {
      await Setting.definir('favicon', '');
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
