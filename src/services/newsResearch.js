const { apurarTopico, decodificarHtml } = require('./articleSource');
const { fatosSimilares, deduplicarTopicos } = require('../utils/topicMatch');
const { marcarRespostaBrave, marcarRespostaBraveOk, braveDisponivel } = require('./braveApi');
const { buscarNoticias } = require('./braveSearch');

const USER_AGENT = 'SiteGospelBot/1.0 (+https://gitlab.com/perfilcursor07-group/obuxixo)';
const DIAS_RECENTES_PADRAO = 5;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

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

function itemEhRecente(item, dias = DIAS_RECENTES_PADRAO) {
  const limite = Date.now() - dias * MS_POR_DIA;
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

function detectarRedeSocial(url, fonte) {
  const lower = `${url || ''} ${fonte || ''}`.toLowerCase();
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'Facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
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

async function buscarBraveWeb(query, palavraChave, limite = 5, { freshness = 'pw', fonteLabel = null } = {}) {
  if (!braveDisponivel()) return [];

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(limite + 3, 20)),
      country: 'BR',
      search_lang: 'pt-br',
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
    }).filter((item) => item.titulo && item.link && itemQualidadeValida(item))
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

async function buscarRedesSociais(palavraChave, limite = 6, dias = 5) {
  const fresh = freshnessBrave(dias);
  const porFonte = Math.max(2, Math.ceil(limite / 3));

  const [igBrave, fbBrave, xBrave, igGoogle, fbGoogle, xGoogle] = await Promise.all([
    buscarBraveWeb(
      `site:instagram.com/reel OR site:instagram.com/p ${palavraChave} gospel (pastor OR igreja OR polêmica OR culto)`,
      palavraChave,
      porFonte,
      { freshness: fresh, fonteLabel: 'Instagram' }
    ),
    buscarBraveWeb(
      `site:facebook.com/posts OR site:facebook.com/watch OR site:facebook.com/photo ${palavraChave} gospel pastor igreja`,
      palavraChave,
      porFonte,
      { freshness: fresh, fonteLabel: 'Facebook' }
    ),
    buscarBraveWeb(
      `(site:twitter.com OR site:x.com) ${palavraChave} gospel (pastor OR igreja OR polêmica)`,
      palavraChave,
      porFonte,
      { freshness: fresh, fonteLabel: 'X (Twitter)' }
    ),
    buscarGoogleNewsSite('instagram.com', palavraChave, porFonte, dias),
    buscarGoogleNewsSite('facebook.com', palavraChave, porFonte, dias),
    buscarGoogleNewsSite('twitter.com', palavraChave, Math.max(1, porFonte - 1), dias)
  ]);

  return [...igBrave, ...fbBrave, ...xBrave, ...igGoogle, ...fbGoogle, ...xGoogle]
    .filter((item) => itemQualidadeValida(item))
    .slice(0, limite);
}

async function pesquisarNichos(palavrasChave, quantidadePorNicho = 5, opcoes = {}) {
  const { incluirRedesSociais = true, somenteRecentes = true, diasRecentes = DIAS_RECENTES_PADRAO } = opcoes;
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!termos.length) throw new Error('Informe ao menos uma palavra-chave ou nicho.');

  const resultados = [];
  const maxRedesPorTermo = Math.max(4, Math.ceil(quantidadePorNicho * 0.5));

  const adicionar = (item) => {
    if (!item?.titulo) return;
    if (!itemQualidadeValida(item)) return;
    if (somenteRecentes && !itemEhRecente(item, diasRecentes)) return;

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
      const promessas = [
        buscarBraveNews(termo, quantidadePorNicho + 4, diasRecentes),
        buscarEmAlta(termo, 4),
        buscarGoogleNews24h(termo, 4),
        buscarGoogleNews(termo, quantidadePorNicho + 2, { dias: diasRecentes }),
        buscarPortaisGospel(termo, 4, diasRecentes),
        buscarWebGospel(termo, 4, diasRecentes)
      ];

      if (incluirRedesSociais) {
        promessas.push(buscarRedesSociais(termo, maxRedesPorTermo, diasRecentes));
      }

      const lotes = await Promise.all(promessas);
      lotes.flat().forEach(adicionar);
    } catch (e) {
      console.error(`Erro ao pesquisar "${termo}":`, e.message);
    }
  }

  resultados.sort((a, b) => pontuarTopico(b) - pontuarTopico(a));

  const limiteFinal = Math.min(resultados.length, termos.length * quantidadePorNicho * 2);
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
    .filter((item) => !somenteRecentes || itemEhRecente(item, diasRecentes) || item.fonte === 'Pauta editorial');

  return finais.slice(0, termos.length * quantidadePorNicho * 2);
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
