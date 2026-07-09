const { apurarTopico, decodificarHtml } = require('./articleSource');
const { fatosSimilares, deduplicarTopicos } = require('../utils/topicMatch');
const { marcarRespostaBrave, marcarRespostaBraveOk, braveDisponivel } = require('./braveApi');
const { buscarNoticias } = require('./braveSearch');

const USER_AGENT = 'SiteGospelBot/1.0 (+https://gitlab.com/perfilcursor07-group/obuxixo)';
const DIAS_RECENTES_PADRAO = 1;
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MS_POR_HORA = 60 * 60 * 1000;

const PORTAIS_GOSPEL = [
  'g1.globo.com',
  'guiame.com.br',
  'gospelprime.com.br',
  'portaldogospel.com.br',
  'folhagospel.com',
  'agenciaelos.com.br',
  'noticias.gospelmais.com.br',
  'panorama.com.br'
];
function limparResumo(texto) {
  return decodificarHtml(texto || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/news\.google\.com[^\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function limparTitulo(titulo) {
  return decodificarHtml(titulo || '')
    .replace(/\s*[-–—|]\s*[^-|–—]{2,60}$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairItensRss(xml) {
  const itens = [];
  const blocos = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const bloco of blocos) {
    const titulo = bloco.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
    const link = bloco.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    const descricao = bloco.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim();
    const data = bloco.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
    if (titulo && link) {
      itens.push({
        titulo: limparTitulo(titulo),
        link,
        resumo: limparResumo(descricao),
        data,
        dataTimestamp: parsearDataPub(data)
      });
    }
  }
  return itens;
}

function parsearDataPub(dataStr) {
  if (!dataStr) return 0;
  const t = Date.parse(dataStr);
  return Number.isNaN(t) ? 0 : t;
}

function parsearIdadeBrave(age) {
  if (!age) return 0;
  const lower = String(age).toLowerCase();
  const num = parseInt(lower, 10);
  if (Number.isNaN(num)) return Date.now();
  if (/hour|hora|h\b/.test(lower)) return Date.now() - num * 3600000;
  if (/day|dia|d\b/.test(lower)) return Date.now() - num * MS_POR_DIA;
  if (/week|semana|sem\b/.test(lower)) return Date.now() - num * 7 * MS_POR_DIA;
  if (/month|mes|mês/.test(lower)) return Date.now() - num * 30 * MS_POR_DIA;
  return 0;
}

function normalizarPeriodo(valor) {
  const str = String(valor ?? '24h').toLowerCase().trim();
  if (str === '24h' || str === '24') {
    return { horas: 24, diasBrave: 1, diasGoogle: 1 };
  }
  const dias = Math.min(Math.max(parseInt(str, 10) || 1, 1), 30);
  return { dias, diasBrave: dias, diasGoogle: dias };
}

function itemEhRecente(item, periodo = DIAS_RECENTES_PADRAO) {
  const cfg = typeof periodo === 'object' && periodo !== null
    ? periodo
    : normalizarPeriodo(periodo);
  const limite = cfg.horas
    ? Date.now() - cfg.horas * MS_POR_HORA
    : Date.now() - (cfg.dias || DIAS_RECENTES_PADRAO) * MS_POR_DIA;
  const ts = item.dataTimestamp || parsearDataPub(item.data) || parsearIdadeBrave(item.idadeBrave);
  if (!ts) {
    if (item.recente && ['rede_social', 'web', 'portal_gospel', 'noticia'].includes(item.tipoFonte)) return true;
    if (item.emAlta || item.fonte === 'Google News — 24h') return true;
    return false;
  }
  return ts >= limite;
}

function urlRedeSocialRelevante(url) {
  if (!url) return false;
  const lower = url.toLowerCase();

  if (lower.includes('instagram.com')) {
    return /\/(p|reel|tv|stories)\//.test(lower);
  }

  if (lower.includes('facebook.com') || lower.includes('fb.com')) {
    return /\/(posts|photos|videos|watch|share|story|permalink)/.test(lower)
      || /\/groups\//.test(lower);
  }

  if (lower.includes('twitter.com') || lower.includes('x.com')) {
    return /\/status\/\d+/.test(lower);
  }

  if (lower.includes('threads.net')) {
    return /\/post\//.test(lower) || /threads\.net\/@/.test(lower);
  }

  if (lower.includes('tiktok.com')) {
    return /\/video\//.test(lower) || /\/@/.test(lower);
  }

  if (lower.includes('youtube.com')) {
    return /\/(shorts|watch)/.test(lower);
  }

  return true;
}

function itemQualidadeValida(item) {
  const titulo = limparTitulo(item.titulo);
  const resumo = limparResumo(item.resumo);
  if (!titulo || titulo.length < 12) return false;

  item.titulo = titulo;
  item.resumo = resumo;

  if (/cannot provide a description/i.test(resumo) && item.tipoFonte === 'rede_social') {
    if (!urlRedeSocialRelevante(item.link)) return false;
  }

  if (/followers.*following.*posts/i.test(resumo)) return false;
  if (/Instagram photos and videos$/i.test(titulo)) return false;
  if (/^@[\w.]+/i.test(titulo)) return false;
  if ((titulo.match(/#/g) || []).length >= 2 && titulo.length < 90) return false;
  if (/^[\w\s#]+$/.test(titulo) && titulo.includes('#') && titulo.split(/\s+/).length < 6) return false;

  if (item.redeSocial || item.tipoFonte === 'rede_social') {
    if (!urlRedeSocialRelevante(item.link)) return false;
    if (titulo.split(/\s+/).filter(Boolean).length < 4) return false;
  }

  if (/<a\s+href|<\/?\w+/.test(item.resumo || '')) {
    item.resumo = limparResumo(item.resumo);
  }

  if (item.resumo && item.resumo.length > 500) return false;

  return true;
}

function pontuarTopico(item) {
  let score = item.dataTimestamp || parsearDataPub(item.data) || parsearIdadeBrave(item.idadeBrave) || 0;
  if (item.emAlta) score += MS_POR_DIA * 2;
  if (item.fonte === 'Brave News') score += MS_POR_DIA * 2;
  if (item.fonte === 'Google News' || item.fonte === 'Google News — em alta') score += MS_POR_DIA;
  if (item.fonte === 'Google News — 24h') score += MS_POR_DIA * 1.5;
  if (item.tipoFonte === 'portal_gospel') score += MS_POR_DIA * 0.5;
  if (item.tipoFonte === 'rede_social') score += MS_POR_DIA * 0.25;
  if (!item.resumo || item.resumo.length < 20) score -= MS_POR_DIA * 0.5;
  return score;
}

function extrairTermosChaveBusca(palavraChave) {
  const stop = new Set(['gospel', 'evangelico', 'evangélico', 'evangelica', 'evangélica', 'brasil', 'noticia', 'notícia', 'louvor', 'adoracao', 'adoração']);
  return (palavraChave || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[\s,;+/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !stop.has(t));
}

function textoItemBusca(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.link || ''} ${item.nicho || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function itemCombinaPalavraChave(item, palavraChave, { rigoroso = false } = {}) {
  const termos = extrairTermosChaveBusca(palavraChave);
  const texto = textoItemBusca(item);
  const contextoGospel = /gospel|evangel|igreja|louvor|pastor|pastora|cantor|cantora|adora|louvou|culto|cristao|cristão|biblia|bíblia|worship|louca|louvores|hino|louvorzao|louvorzão/.test(texto);

  if (!termos.length) {
    return rigoroso ? contextoGospel : true;
  }

  const acertos = termos.filter((t) => texto.includes(t));
  if (rigoroso) {
    if (acertos.length >= Math.min(2, termos.length)) return true;
    if (acertos.length >= 1 && contextoGospel) return true;
    return acertos.length >= 1 && termos.length === 1;
  }

  return acertos.length >= 1 || contextoGospel;
}

const RUIDO_REDES_SOCIAIS = [
  'messi', 'mbappe', 'ronaldo', 'real madrid', 'barcelona', 'fútbol', 'futebol',
  'premier league', 'champions league', 'nba', 'ufc', 'netflix', 'disney',
  'derbez', 'hollywood', 'anime', 'naruto', 'crunchyroll', 'btc', 'bitcoin',
  'criptomoeda', 'horóscopo', 'horoscopo', 'receita de bolo', 'loteria'
];

function itemRelevanteRedeSocial(item, palavraChave) {
  if (!itemCombinaPalavraChave(item, palavraChave, { rigoroso: true })) return false;

  const texto = textoItemBusca(item);
  const temRuido = RUIDO_REDES_SOCIAIS.some((r) => texto.includes(r));
  const contextoGospel = /gospel|evangel|igreja|louvor|pastor|pastora|cantor|cantora|adora|louvou|culto|cristao|cristão|biblia|bíblia|worship|louvor/.test(texto);

  if (temRuido && !contextoGospel) return false;

  const termos = extrairTermosChaveBusca(palavraChave);
  if (termos.length && !termos.some((t) => texto.includes(t))) return false;

  return true;
}

function pontuarRelevanciaRede(item, palavraChave) {
  const texto = textoItemBusca(item);
  const termos = extrairTermosChaveBusca(palavraChave);
  let score = pontuarTopico(item);

  for (const t of termos) {
    if (texto.includes(t)) score += MS_POR_DIA;
  }
  if (/gospel|evangel|louvor|igreja/.test(texto)) score += MS_POR_DIA * 0.5;
  if (item.redeSocial === 'Instagram') score += MS_POR_HORA * 6;
  if (item.link?.includes('instagram.com/reel')) score += MS_POR_HORA * 4;
  if (RUIDO_REDES_SOCIAIS.some((r) => texto.includes(r))) score -= MS_POR_DIA * 3;

  return score;
}

function montarConsultasRedesSociais(palavraChave) {
  const termo = palavraChave.trim();
  const termoAspas = termo.includes(' ') ? `"${termo}"` : termo;
  const fresh = 'pd';

  return [
    { q: `site:instagram.com/p ${termoAspas}`, rede: 'Instagram', limite: 10, fresh },
    { q: `site:instagram.com/reel ${termoAspas}`, rede: 'Instagram', limite: 10, fresh },
    { q: `site:instagram.com ${termo} gospel louvor adoração`, rede: 'Instagram', limite: 8, fresh },
    { q: `site:instagram.com ${termo} (cantora OR cantor OR louvor OR igreja)`, rede: 'Instagram', limite: 8, fresh },
    { q: `site:facebook.com ${termoAspas} gospel`, rede: 'Facebook', limite: 8, fresh },
    { q: `site:facebook.com/posts ${termo} louvor igreja`, rede: 'Facebook', limite: 8, fresh },
    { q: `site:facebook.com/watch ${termo} gospel`, rede: 'Facebook', limite: 6, fresh },
    { q: `site:threads.net ${termo} gospel`, rede: 'Threads', limite: 6, fresh },
    { q: `site:tiktok.com ${termo} gospel louvor`, rede: 'TikTok', limite: 8, fresh },
    { q: `(site:twitter.com OR site:x.com) ${termoAspas} (gospel OR louvor OR igreja OR evangélico)`, rede: 'X (Twitter)', limite: 6, fresh },
    { q: `(site:twitter.com OR site:x.com) ${termo} gospel brasil`, rede: 'X (Twitter)', limite: 6, fresh },
    { q: `site:youtube.com/shorts ${termo} gospel`, rede: 'YouTube', limite: 5, fresh },
    { q: `site:instagram.com/p OR site:instagram.com/reel ${termo} polêmica gospel`, rede: 'Instagram', limite: 6, fresh }
  ];
}

function detectarRedeSocial(url, fonte) {
  const lower = `${url || ''} ${fonte || ''}`.toLowerCase();
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'Facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
  if (lower.includes('threads.net')) return 'Threads';
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('youtube.com')) return 'YouTube';
  return null;
}

function freshnessBrave(dias) {
  if (dias <= 1) return 'pd';
  if (dias <= 7) return 'pw';
  return 'pm';
}

async function buscarGoogleNews(palavraChave, limite = 5, { dias = DIAS_RECENTES_PADRAO } = {}) {
  const base = `${palavraChave} gospel OR evangélico OR igreja OR cristão when:${dias}d`;
  const query = encodeURIComponent(base);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return [];
  const xml = await res.text();
  return extrairItensRss(xml)
    .filter((item) => itemEhRecente(item, dias))
    .slice(0, limite)
    .map((item) => ({
      ...item,
      nicho: palavraChave,
      fonte: 'Google News',
      recente: true
    }));
}

async function buscarEmAlta(palavraChave, limite = 4) {
  const query = encodeURIComponent(`${palavraChave} gospel when:1d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return extrairItensRss(xml)
      .filter((item) => itemEhRecente(item, 1))
      .slice(0, limite)
      .map((item) => ({
        ...item,
        nicho: palavraChave,
        fonte: 'Google News — em alta',
        emAlta: true,
        recente: true
      }));
  } catch {
    return [];
  }
}

async function buscarGoogleNews24h(palavraChave, limite = 4) {
  return buscarGoogleNews(palavraChave, limite, { dias: 1 }).then((itens) =>
    itens.map((item) => ({ ...item, fonte: 'Google News — 24h' }))
  );
}

async function buscarGoogleNewsSite(site, palavraChave, limite = 2, dias = 5) {
  const query = encodeURIComponent(`site:${site} ${palavraChave} gospel when:${dias}d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const rede = site.includes('instagram') ? 'Instagram'
      : site.includes('facebook') ? 'Facebook'
        : (site.includes('twitter') || site.includes('x.com')) ? 'X (Twitter)'
          : site;
    return extrairItensRss(xml)
      .filter((item) => itemEhRecente(item, dias) && itemQualidadeValida(item))
      .slice(0, limite)
      .map((item) => ({
        ...item,
        nicho: palavraChave,
        fonte: rede,
        redeSocial: rede,
        tipoFonte: 'rede_social',
        recente: true
      }));
  } catch {
    return [];
  }
}

async function buscarBraveNews(palavraChave, limite = 6, dias = 5) {
  if (!braveDisponivel()) return [];

  const fresh = freshnessBrave(dias);
  const itens = await buscarNoticias(
    `${palavraChave} gospel evangélico igreja brasil`,
    { count: limite, freshness: fresh }
  );

  return itens.map((item) => ({
    titulo: limparTitulo(item.titulo),
    link: item.link,
    resumo: limparResumo(item.resumo),
    data: item.idade,
    idadeBrave: item.idade,
    dataTimestamp: parsearIdadeBrave(item.idade),
    nicho: palavraChave,
    fonte: 'Brave News',
    veiculo: item.veiculo,
    tipoFonte: 'noticia',
    recente: true
  })).filter((item) => itemQualidadeValida(item));
}

async function buscarBraveWeb(query, palavraChave, limite = 5, { freshness = 'pw', fonteLabel = null, somenteRede = false } = {}) {
  if (!braveDisponivel()) return [];

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(Math.max(limite + 5, 10), 20)),
      country: 'BR',
      search_lang: 'pt-br',
      ui_lang: 'pt-BR',
      freshness
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const erro = await res.text();
      marcarRespostaBrave(res, erro);
      return [];
    }

    marcarRespostaBraveOk();

    const data = await res.json();
    return (data.web?.results || []).map((item) => {
      const rede = detectarRedeSocial(item.url, item.profile?.name);
      const idadeBrave = item.age || null;
      return {
        titulo: limparTitulo(item.title || ''),
        link: item.url,
        resumo: limparResumo(item.description || ''),
        data: idadeBrave,
        idadeBrave,
        dataTimestamp: parsearIdadeBrave(idadeBrave),
        nicho: palavraChave,
        fonte: fonteLabel || rede || 'Web',
        redeSocial: rede,
        tipoFonte: rede ? 'rede_social' : 'web',
        recente: true
      };
    }).filter((item) => {
      if (!item.titulo || !item.link || !itemQualidadeValida(item)) return false;
      if (somenteRede && !item.redeSocial) return false;
      return true;
    })
      .slice(0, limite);
  } catch (e) {
    console.warn('buscarBraveWeb:', e.message);
    return [];
  }
}

async function buscarPortaisGospel(palavraChave, limite = 5, dias = 5) {
  if (!braveDisponivel()) return [];

  const fresh = freshnessBrave(dias);
  const sites = PORTAIS_GOSPEL.slice(0, 3);
  const lotes = await Promise.all(
    sites.map((site) =>
      buscarBraveWeb(
        `site:${site} ${palavraChave} gospel OR evangélico OR igreja`,
        palavraChave,
        2,
        { freshness: fresh, fonteLabel: site.replace(/^www\./, '') }
      )
    )
  );

  return lotes.flat()
    .map((item) => ({ ...item, tipoFonte: 'portal_gospel' }))
    .slice(0, limite);
}

async function buscarWebGospel(palavraChave, limite = 5, dias = 5) {
  const fresh = freshnessBrave(dias);
  const consultas = [
    `${palavraChave} gospel brasil notícia polêmica pastor igreja`,
    `${palavraChave} evangélico repercussão redes sociais`,
    `"${palavraChave}" gospel breaking news brasil`
  ];

  const lotes = await Promise.all(
    consultas.map((q) => buscarBraveWeb(q, palavraChave, Math.ceil(limite / 2), { freshness: fresh, fonteLabel: 'Google/Web' }))
  );

  return lotes.flat().slice(0, limite);
}

async function buscarRedesSociais(palavraChave, limite = 6, dias = 5, { modoAmpliado = false } = {}) {
  const fresh = freshnessBrave(dias);
  const consultas = montarConsultasRedesSociais(palavraChave);
  const vistos = new Set();
  const candidatos = [];

  const lotesBrave = await Promise.all(
    consultas.map((c) =>
      buscarBraveWeb(c.q, palavraChave, c.limite, {
        freshness: c.fresh || fresh,
        fonteLabel: c.rede,
        somenteRede: true
      })
    )
  );

  for (const item of lotesBrave.flat()) {
    if (!item?.link || vistos.has(item.link)) continue;
    if (!itemRelevanteRedeSocial(item, palavraChave)) continue;
    vistos.add(item.link);
    candidatos.push(item);
  }

  const porFonteGoogle = modoAmpliado ? 6 : 4;
  const [igGoogle, fbGoogle, xGoogle] = await Promise.all([
    buscarGoogleNewsSite('instagram.com', palavraChave, porFonteGoogle, dias),
    buscarGoogleNewsSite('facebook.com', palavraChave, porFonteGoogle, dias),
    buscarGoogleNewsSite('twitter.com', palavraChave, Math.max(3, porFonteGoogle - 1), dias)
  ]);

  for (const item of [...igGoogle, ...fbGoogle, ...xGoogle]) {
    if (!item?.link || vistos.has(item.link)) continue;
    if (!itemRelevanteRedeSocial(item, palavraChave)) continue;
    vistos.add(item.link);
    candidatos.push(item);
  }

  return candidatos
    .sort((a, b) => pontuarRelevanciaRede(b, palavraChave) - pontuarRelevanciaRede(a, palavraChave))
    .slice(0, limite);
}

async function pesquisarNichos(palavrasChave, quantidadePorNicho = 5, opcoes = {}) {
  const {
    incluirRedesSociais = true,
    somenteRedesSociais = false,
    somenteRecentes = true,
    diasRecentes = '24h'
  } = opcoes;
  const periodo = normalizarPeriodo(diasRecentes);
  const diasBusca = periodo.diasGoogle || periodo.diasBrave || 1;
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!termos.length) throw new Error('Informe ao menos uma palavra-chave ou nicho.');

  const resultados = [];
  const maxRedesPorTermo = Math.max(4, Math.ceil(quantidadePorNicho * 0.5));

  const adicionar = (item, termoOrigem) => {
    if (!item?.titulo) return;
    if (somenteRedesSociais && !itemRelevanteRedeSocial(item, termoOrigem || item.nicho)) return;
    if (!itemQualidadeValida(item)) return;
    if (somenteRecentes && !itemEhRecente(item, periodo)) return;

    const dup = resultados.find((r) =>
      fatosSimilares(r.titulo, item.titulo, r.resumo, item.resumo)
    );
    if (dup) {
      if (item.emAlta && !dup.emAlta) dup.emAlta = true;
      if ((item.resumo || '').length > (dup.resumo || '').length) dup.resumo = item.resumo;
      if (!dup.redeSocial && item.redeSocial) dup.redeSocial = item.redeSocial;
      return;
    }
    if (item.link && resultados.some((r) => r.link === item.link)) return;

    resultados.push({
      id: `topic-${resultados.length + 1}`,
      ...item,
      recente: somenteRecentes
    });
  };

  for (const termo of termos) {
    try {
      let promessas;

      if (somenteRedesSociais) {
        promessas = [
          buscarRedesSociais(termo, Math.max(quantidadePorNicho * 5, 25), diasBusca, { modoAmpliado: true })
        ];
      } else {
        promessas = [
          buscarBraveNews(termo, quantidadePorNicho + 4, diasBusca),
          buscarEmAlta(termo, 4),
          buscarGoogleNews24h(termo, 4),
          buscarGoogleNews(termo, quantidadePorNicho + 2, { dias: diasBusca }),
          buscarPortaisGospel(termo, 4, diasBusca),
          buscarWebGospel(termo, 4, diasBusca)
        ];

        if (incluirRedesSociais) {
          promessas.push(buscarRedesSociais(termo, maxRedesPorTermo, diasBusca));
        }
      }

      const lotes = await Promise.all(promessas);
      lotes.flat().forEach((item) => adicionar(item, termo));
    } catch (e) {
      console.error(`Erro ao pesquisar "${termo}":`, e.message);
    }
  }

  resultados.sort((a, b) => {
    if (somenteRedesSociais) {
      return pontuarRelevanciaRede(b, b.nicho) - pontuarRelevanciaRede(a, a.nicho);
    }
    return pontuarTopico(b) - pontuarTopico(a);
  });

  const multiplicador = somenteRedesSociais ? 4 : 2;
  const limiteFinal = Math.min(resultados.length, termos.length * quantidadePorNicho * multiplicador);
  const selecionados = resultados.slice(0, limiteFinal);

  if (!selecionados.length) {
    for (const termo of termos) {
      adicionar({
        titulo: `Apuração: o que está em alta sobre ${termo} no meio gospel esta semana`,
        resumo: `Levantamento de fatos recentes e repercussão sobre ${termo} no cenário evangélico brasileiro.`,
        link: null,
        nicho: termo,
        fonte: 'Pauta editorial',
        dataTimestamp: Date.now(),
        recente: true
      });
    }
    return deduplicarTopicos(resultados).slice(0, termos.length * quantidadePorNicho);
  }

  const limiteApuracao = Math.min(selecionados.length, 12);
  const apurados = await Promise.all(
    selecionados.slice(0, limiteApuracao).map((item) => apurarTopico(item))
  );

  const finais = deduplicarTopicos([...apurados, ...selecionados.slice(limiteApuracao)])
    .filter((item) => itemQualidadeValida(item))
    .filter((item) => !somenteRedesSociais || itemRelevanteRedeSocial(item, item.nicho))
    .filter((item) => !somenteRecentes || itemEhRecente(item, periodo) || item.fonte === 'Pauta editorial');

  return finais.slice(0, termos.length * quantidadePorNicho * (somenteRedesSociais ? 4 : 2));
}

module.exports = {
  pesquisarNichos,
  buscarGoogleNews,
  buscarBraveNews,
  buscarRedesSociais,
  buscarPortaisGospel,
  buscarWebGospel,
  apurarTopico,
  itemEhRecente,
  itemQualidadeValida
};
