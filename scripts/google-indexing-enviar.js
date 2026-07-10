#!/usr/bin/env node
/**
 * Envia posts recentes ao Google Indexing API.
 * Uso: node scripts/google-indexing-enviar.js [limite]
 */
require('dotenv').config();
const sequelize = require('../src/config/database');
const { Post } = require('../src/models');
const { Setting } = require('../src/models');
const { enviarUrls, obterQuotaHoje, estaConfigurado } = require('../src/services/googleIndexing');
const { obterUrlBase } = require('../src/utils/requestUrl');

async function main() {
  const limite = Math.min(parseInt(process.argv[2], 10) || 30, 200);

  if (!estaConfigurado()) {
    console.error('Erro: coloque config/google-indexing-key.json ou defina GOOGLE_INDEXING_KEY_FILE no .env');
    process.exit(1);
  }

  await sequelize.authenticate();
  const config = await Setting.obterTodas();
  const base = obterUrlBase(null, config) || process.env.SITE_URL;
  if (!base) {
    console.error('Erro: configure SITE_URL ou sitemap_url_canonica no admin.');
    process.exit(1);
  }

  const quota = await obterQuotaHoje();
  console.log(`Cota hoje: ${quota.enviados}/${200} enviados, restam ${quota.restantes}`);

  const posts = await Post.findAll({
    where: { status: 'publicado' },
    attributes: ['slug', 'titulo'],
    order: [['publicadoEm', 'DESC']],
    limit: limite
  });

  const urls = posts.map((p) => `${base.replace(/\/+$/, '')}/post/${p.slug}`);
  console.log(`Enviando ${urls.length} URL(s)...`);

  const resultado = await enviarUrls(urls, { limite });
  console.log(`OK: ${resultado.ok.length}, erros: ${resultado.erros.length}`);
  resultado.erros.forEach((e) => console.error(' -', e.url, e.erro));
  console.log(`Cota restante: ${resultado.quota.restantes}`);

  await sequelize.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
