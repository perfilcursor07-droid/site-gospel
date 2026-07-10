const router = require('express').Router();
const { Setting } = require('../../models');
const { permitir } = require('../../middlewares/auth');
const upload = require('../../config/upload');
const { obterResumo } = require('../../services/sitemap');
const { gerarChaveIndexNow } = require('../../services/indexacao');
const { sugerirConfiguracaoSite } = require('../../services/siteConfigAi');
const {
  estaConfigurado,
  obterEmailContaServico,
  obterQuotaHoje,
  testarConexao,
  enviarUrls,
  QUOTA_DIARIA_PADRAO
} = require('../../services/googleIndexing');
const { Post } = require('../../models');
const { obterUrlBase } = require('../../utils/requestUrl');
const { extrairClientAdSense } = require('../../utils/amp');

router.use(permitir('administrador'));

router.get('/', async (req, res, next) => {
  try {
    const config = await Setting.obterTodas();
    let sitemap;
    try {
      sitemap = await obterResumo(config, req);
    } catch (erroSitemap) {
      console.error('Erro ao gerar resumo do sitemap:', erroSitemap);
      const base = `${req.protocol}://${req.get('host')}`;
      sitemap = {
        base,
        urls: [],
        urlsNews: [],
        contagem: { home: 0, posts: 0, categorias: 0, paginas: 0, news: 0, total: 0 },
        sitemaps: [{ loc: `${base}/sitemap.xml`, tipo: 'principal' }],
        robotsUrl: `${base}/robots.txt`,
        googleSearchConsoleUrl: 'https://search.google.com/search-console',
        googleSitemapPingUrl: null,
        indexar: (config.seo_indexar || 'sim') !== 'nao',
        amostra: [],
        erro: erroSitemap.message
      };
    }
    res.render('admin/settings/form', {
      titulo: 'Configurações',
      config,
      sitemap,
      googleIndexing: {
        configurado: estaConfigurado(),
        email: obterEmailContaServico(),
        quota: await obterQuotaHoje(),
        quotaMax: QUOTA_DIARIA_PADRAO
      }
    });
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
      'google_adsense',
      'google_adsense_client',
      'head_custom',
      'footer_copyright',
      'footer_links'
    ];
    for (const campo of campos) {
      if (campo in req.body) await Setting.definir(campo, (req.body[campo] || '').trim());
    }

    // Toggle de indexação: quando desligado, aplica noindex + bloqueia no robots.txt
    await Setting.definir('seo_indexar', req.body.seo_indexar === 'on' ? 'sim' : 'nao');

    const camposSitemap = [
      'sitemap_url_canonica',
      'sitemap_changefreq_home',
      'sitemap_changefreq_posts',
      'sitemap_changefreq_categorias',
      'sitemap_changefreq_paginas'
    ];
    for (const campo of camposSitemap) {
      if (campo in req.body) await Setting.definir(campo, (req.body[campo] || '').trim());
    }
    await Setting.definir('sitemap_incluir_home', req.body.sitemap_incluir_home === 'on' ? 'sim' : 'nao');
    await Setting.definir('sitemap_incluir_posts', req.body.sitemap_incluir_posts === 'on' ? 'sim' : 'nao');
    await Setting.definir('sitemap_incluir_categorias', req.body.sitemap_incluir_categorias === 'on' ? 'sim' : 'nao');
    await Setting.definir('sitemap_incluir_paginas', req.body.sitemap_incluir_paginas === 'on' ? 'sim' : 'nao');
    await Setting.definir('sitemap_news_ativo', req.body.sitemap_news_ativo === 'on' ? 'sim' : 'nao');

    if (req.body.gerar_indexnow === '1') {
      await Setting.definir('indexnow_chave', gerarChaveIndexNow());
    } else if ('indexnow_chave' in req.body) {
      await Setting.definir('indexnow_chave', (req.body.indexnow_chave || '').trim());
    }

    await Setting.definir('amp_habilitado', req.body.amp_habilitado === 'on' ? 'sim' : 'nao');
    await Setting.definir('amp_adsense', req.body.amp_adsense === 'on' ? 'sim' : 'nao');

    const camposAmp = ['amp_logo_largura', 'amp_logo_altura', 'amp_logo_texto_tamanho'];
    for (const campo of camposAmp) {
      if (campo in req.body) await Setting.definir(campo, (req.body[campo] || '').trim());
    }

    const adsenseClient = (req.body.google_adsense_client || '').trim()
      || extrairClientAdSense(req.body.google_adsense || '');
    if (adsenseClient) await Setting.definir('google_adsense_client', adsenseClient);

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

    await Setting.definir('google_indexing_ativo', req.body.google_indexing_ativo === 'on' ? 'sim' : 'nao');

    req.flash('sucesso', 'Configurações salvas com sucesso.');
  } catch (e) {
    req.flash('erro', 'Erro ao salvar configurações: ' + e.message);
  }
  res.redirect('/admin/configuracoes');
});

router.post('/google-indexing/testar', async (req, res) => {
  try {
    const config = await Setting.obterTodas();
    const base = obterUrlBase(req, config);
    const urlTeste = base ? `${base}/sitemap.xml` : null;
    const resultado = await testarConexao(urlTeste);
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post('/google-indexing/enviar', async (req, res) => {
  try {
    const config = await Setting.obterTodas();
    const base = obterUrlBase(req, config);
    if (!base) {
      return res.status(400).json({ ok: false, erro: 'Configure a URL canônica do site na aba Sitemap.' });
    }

    const limite = Math.min(Math.max(parseInt(req.body.limite, 10) || 30, 1), 200);
    const posts = await Post.findAll({
      where: { status: 'publicado' },
      attributes: ['slug'],
      order: [['publicadoEm', 'DESC']],
      limit: limite
    });

    const urls = posts.map((p) => `${base}/post/${p.slug}`);
    const resultado = await enviarUrls(urls, { limite });

    res.json({
      ok: true,
      enviados: resultado.ok.length,
      erros: resultado.erros,
      ignorados: resultado.ignorados,
      quota: resultado.quota,
      mensagem: `${resultado.ok.length} URL(s) enviada(s) ao Google.${resultado.erros.length ? ` ${resultado.erros.length} com erro.` : ''}`
    });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

router.post('/ia-sugerir', async (req, res) => {
  try {
    const descricao = (req.body.descricao || '').trim();
    const secao = (req.body.secao || 'todas').trim();
    const config = await Setting.obterTodas();
    const sugestoes = await sugerirConfiguracaoSite({ descricao, secao, configAtual: config });
    res.json({ ok: true, sugestoes });
  } catch (e) {
    const status = e.message.includes('DEEPSEEK_API_KEY') ? 503 : 400;
    res.status(status).json({ ok: false, erro: e.message });
  }
});

module.exports = router;
