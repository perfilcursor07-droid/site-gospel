const { apurarTopico, decodificarHtml } = require('./articleSource');
const { fatosSimilares, titulosSimilares, deduplicarTopicos } = require('../utils/topicMatch');
const { marcarRespostaBrave, marcarRespostaBraveOk, braveDisponivel } = require('./braveApi');
const { buscarNoticias } = require('./braveSearch');
const { buscarGoogleTrends } = require('./googleTrends');
const { serperPost, serperDisponivel, serperPermiteConsultasAvancadas, montarConsultasSerperRedesGratis } = require('./serperApi');

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
  'panorama.com.br',
  'pleno.news',
  'gospelcenter.com.br',
  'supergospelsp.com.br',
  'verdadegospel.com.br',
  'boasnoticias.org',
  'cancaonova.com',
  'padrenosso.com.br',
  'gospelvida.com.br',
  'mensagemdepaz.org',
  'adoradores.com.br'
];
function limparResumo(texto, max = 400) {
  return decodificarHtml(texto || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/news\.google\.com[^\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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
  const ts = item.dataTimestamp || parsearDataPub(item.data) || parsearIdadeBrave(item.idadeBrave) || parsearDataRelativa(item.data);
  const ehRede = item.tipoFonte === 'rede_social' || item.redeSocial;

  if (!ts) {
    if (ehRede) {
      const janelaCurta = cfg.horas || (cfg.dias || 1) <= 1;
      if (item.fromSerper && item.recente) return true;
      return !janelaCurta && item.recente === true;
    }
    if (item.recente && ['web', 'portal_gospel', 'noticia'].includes(item.tipoFonte)) return true;
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

  if (item.resumo && item.resumo.length > 500 && item.tipoFonte !== 'rede_social' && !item.redeSocial) return false;

  return true;
}

function pontuarTopico(item) {
  let score = item.dataTimestamp || parsearDataPub(item.data) || parsearIdadeBrave(item.idadeBrave) || 0;
  if (item.emAlta) score += MS_POR_DIA * 2;
  if (item.fonte === 'Brave News') score += MS_POR_DIA * 2;
  if (item.fonte === 'Google News' || item.fonte === 'Google News — em alta') score += MS_POR_DIA;
  if (item.fonte === 'Google News — 24h') score += MS_POR_DIA * 1.5;
  if (item.fonte === 'Google Trends') score += MS_POR_DIA * 2.5;
  if (item.tipoFonte === 'trends') score += MS_POR_DIA * 1.5;
  if (item.tipoFonte === 'portal_gospel') score += MS_POR_DIA * 0.5;
  if (item.tipoFonte === 'rede_social') score += MS_POR_DIA * 0.25;
  if (item.fonteInternacional || item.tipoFonte === 'internacional') score += MS_POR_DIA * 0.75;
  if (!item.resumo || item.resumo.length < 20) score -= MS_POR_DIA * 0.5;
  return score;
}

const TERMOS_GOSPEL_CONTEXTO = /gospel|evangel|igreja|louvor|adora|adoracao|worship|cristao|crista|biblia|ministerio|pregacao|pregador|pregadora|pastor|pastora|pastores|culto|louvou|hino|louvores|jesus|deus|oracao|fe\b|seminario|testemunho|church|chapel|benção|bencao|fiel|congregacao|congregação|malafaia|quadrangular|evangelho/i;

const TERMOS_AMBIGUOS_REDE = new Set([
  'pastor', 'pastora', 'pastores', 'louvor', 'louvores', 'adoracao', 'adoracao',
  'culto', 'congresso', 'testemunho', 'gospel', 'pregador', 'pregadora', 'cantor', 'cantora'
]);

const RUIDO_REDES_SOCIAIS = [
  'messi', 'mbappe', 'ronaldo', 'real madrid', 'barcelona', 'fútbol', 'futebol', 'fifa',
  'premier league', 'champions league', 'nba', 'ufc', 'netflix', 'disney', 'crunchyroll',
  'derbez', 'hollywood', 'anime', 'naruto', 'btc', 'bitcoin', 'criptomoeda',
  'horóscopo', 'horoscopo', 'receita de bolo', 'loteria', 'wimbledon', 'mbappe',
  'bellingham', 'stardew', 'clash of clans', 'mmorpg', 'mmorpg', 'enhypen', 'k-pop',
  'copa do mundo', 'world cup', 'dolby atmos', 'heartstopper', 'euphoria', 'reddit.com/r/',
  'stardewvalley', 'futbol', 'soccer', 'tennis', 'wrestling', 'ufc', 'magalu', 'cupom',
  'afiliad', 'day trade', 'mmonews', 'jogos olimpicos', 'selecao espanola', 'orbán',
  'palestin', 'ucrania', 'ukraine', 'hungria', 'iranian', 'hegseth', 'homeland security',
  'presidente da fifa', 'argentina x', 'copa america', 'mundial',
  'pastores afganos', 'pastor alemao', 'pastor alemão', 'raça pastor', 'dog breed',
  'philippine', 'filipino man', 'kwai', 'tiktok dance', 'meme', 'shitpost',
  'divina pastora', 'hermandad', 'primitiva hermandad', 'es la reina de los cielos',
  'pastoracapu', 'pastorasmarina', 'bata de cola', 'semana santa'
];

function extrairTermosChaveBusca(palavraChave) {
  const bruto = (palavraChave || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[\s,;+/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

  if (!bruto.length) return [];

  const stopParcial = new Set(['brasil', 'noticia', 'notícias', 'noticias']);
  return bruto.filter((t) => !stopParcial.has(t));
}

function textoConteudoItem(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.conteudoRede || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function textoItemBusca(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.link || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parsearDataRelativa(str) {
  if (!str) return 0;
  const lower = String(str).toLowerCase();
  const num = parseInt(lower, 10);
  if (Number.isNaN(num)) return 0;
  if (/hora|hour|\bh\b/.test(lower)) return Date.now() - num * MS_POR_HORA;
  if (/dia|day|\bd\b/.test(lower)) return Date.now() - num * MS_POR_DIA;
  if (/semana|week|\bsem\b/.test(lower)) return Date.now() - num * 7 * MS_POR_DIA;
  if (/mes|month|\bm\b/.test(lower)) return Date.now() - num * 30 * MS_POR_DIA;
  return 0;
}

function termoComoPalavra(texto, termo) {
  if (!termo || !texto) return false;
  const t = termo.toLowerCase();
  if (t === 'pastora' && /\bpastoras?\b/.test(texto)) return true;
  if (t === 'pastor' && /\bpastores?\b/.test(texto)) return true;
  if (t === 'louvor' && /\blouvou?res?\b/.test(texto)) return true;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s.,;:!?¿¡"''"()\\[\\]/@#-])${esc}(?:$|[\\s.,;:!?¿¡"''"()\\[\\]/@#-])`, 'i').test(` ${texto} `);
}

function temContextoGospel(texto) {
  return TERMOS_GOSPEL_CONTEXTO.test(texto);
}

function contextoEvangelicoBrasil(texto) {
  return temContextoGospel(texto)
    || /\b(brasil|brasileir|evangelic|gospel|igreja|ministerio|ministerio|fiel|congresso|conferencia)\b/i.test(texto);
}

function termoAmbiguo(termo) {
  return TERMOS_AMBIGUOS_REDE.has(termo.toLowerCase());
}

function termoParaConsultaRede(palavraChave) {
  const termo = palavraChave.trim();
  const norm = termo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (temContextoGospel(norm) || /\bgospel\b/.test(norm)) return termo;
  if (termoAmbiguo(norm) || norm.length < 12) {
    return `${termo} gospel brasil`;
  }
  return `${termo} gospel igreja`;
}

function itemCombinaPalavraChave(item, palavraChave, { rigoroso = false, redeSocial = false } = {}) {
  const termos = extrairTermosChaveBusca(palavraChave);
  const texto = redeSocial ? textoConteudoItem(item) : textoItemBusca(item);
  const contextoGospel = temContextoGospel(texto);

  if (!termos.length) {
    return rigoroso ? contextoGospel : true;
  }

  const acertos = termos.filter((t) => termoComoPalavra(texto, t));
  if (!acertos.length) return false;

  if (redeSocial || rigoroso) {
    if (!contextoEvangelicoBrasil(texto)) return false;
    return acertos.length >= 1;
  }

  return acertos.length >= 1 || contextoGospel;
}

function itemRelevanteRedeSocial(item, palavraChave) {
  const texto = textoConteudoItem(item);
  if (!texto || texto.replace(/\s+/g, '').length < 18) return false;

  if (RUIDO_REDES_SOCIAIS.some((r) => texto.includes(r))) return false;

  if (!itemCombinaPalavraChave(item, palavraChave, { rigoroso: true, redeSocial: true })) {
    return false;
  }

  const termos = extrairTermosChaveBusca(palavraChave);

  if (!contextoEvangelicoBrasil(texto)) return false;

  if (termos.some((t) => t === 'pastor' || t === 'pastora' || t === 'pastores')) {
    if (/\b(pastor(?:es)?\s+afgano|pastor\s+alemao|pastor\s+alemão|dog|perro|cachorro|raça)\b/i.test(texto)) {
      return false;
    }
  }

  return true;
}

function periodoParaSerperTbs(cfg) {
  if (cfg.horas || (cfg.dias || 1) <= 1) return 'qdr:d';
  if ((cfg.dias || 1) <= 7) return 'qdr:w';
  return 'qdr:m';
}

function montarConsultasSerperRedes(palavraChave) {
  if (!serperPermiteConsultasAvancadas()) {
    return montarConsultasSerperRedesGratis(palavraChave);
  }
  const termo = palavraChave.trim();
  return [
    { q: `${termo} site:instagram.com`, rede: 'Instagram', limite: 20 },
    { q: `${termo} evangelica site:instagram.com`, rede: 'Instagram', limite: 15 },
    { q: `${termo} site:instagram.com/reel`, rede: 'Instagram', limite: 15 },
    { q: `${termo} site:facebook.com`, rede: 'Facebook', limite: 15 },
    { q: `${termo} site:facebook.com/posts`, rede: 'Facebook', limite: 12 },
    { q: `${termo} site:x.com`, rede: 'X (Twitter)', limite: 15 },
    { q: `${termo} gospel site:x.com`, rede: 'X (Twitter)', limite: 12 },
    { q: `${termo} site:threads.net`, rede: 'Threads', limite: 10 },
    { q: `${termo} site:tiktok.com`, rede: 'TikTok', limite: 10 },
    { q: `${termo} gospel site:youtube.com`, rede: 'YouTube', limite: 10 }
  ];
}

async function buscarSerperWeb(query, palavraChave, { tbs, redeLabel, limite = 15 } = {}) {
  if (!serperDisponivel()) return [];

  const body = {
    q: query,
    gl: 'br',
    hl: 'pt-br',
    num: Math.min(Math.max(limite, 10), 20)
  };
  if (tbs) body.tbs = tbs;

  const { ok, data, bloqueado, ignorado, texto, status } = await serperPost('search', body);
  if (ignorado) return [];
  if (!ok) {
    if (!bloqueado) console.warn('Serper Web:', status, (texto || '').slice(0, 200));
    return [];
  }

  try {
    return (data.organic || []).map((item) => {
      const rede = detectarRedeSocial(item.link, redeLabel) || redeLabel;
      const dataRel = item.date || '';
      return {
        titulo: limparTitulo(item.title || ''),
        link: item.link,
        resumo: limparResumo(item.snippet || '', 600),
        conteudoRede: limparResumo(`${item.title || ''} ${item.snippet || ''}`, 800),
        data: dataRel,
        idadeBrave: dataRel,
        dataTimestamp: parsearDataRelativa(dataRel) || parsearIdadeBrave(dataRel),
        nicho: palavraChave,
        fonte: rede || 'Serper',
        redeSocial: rede,
        tipoFonte: 'rede_social',
        recente: true,
        fromSerper: true
      };
    }).filter((item) => item.titulo && item.link && itemQualidadeValida(item));
  } catch (e) {
    console.warn('buscarSerperWeb:', e.message);
    return [];
  }
}

async function buscarSerperRedesSociais(palavraChave, periodoCfg, { limitePorConsulta = 15 } = {}) {
  if (!serperDisponivel()) return [];

  const tbs = periodoParaSerperTbs(periodoCfg);
  const consultas = montarConsultasSerperRedes(palavraChave);
  const lotes = await Promise.all(
    consultas.map((c) => buscarSerperWeb(c.q, palavraChave, {
      tbs,
      redeLabel: c.rede,
      limite: c.limite || limitePorConsulta
    }))
  );
  return lotes.flat();
}

function pontuarRelevanciaRede(item, palavraChave) {
  const texto = textoConteudoItem(item);
  const termos = extrairTermosChaveBusca(palavraChave);
  let score = pontuarTopico(item);

  for (const t of termos) {
    if (termoComoPalavra(texto, t)) score += MS_POR_DIA;
  }
  if (temContextoGospel(texto)) score += MS_POR_DIA * 0.75;
  if (item.redeSocial === 'Instagram') score += MS_POR_HORA * 6;
  if (item.redeSocial === 'Facebook') score += MS_POR_HORA * 5;
  if (item.redeSocial === 'X (Twitter)') score += MS_POR_HORA * 3;
  if (item.link?.includes('instagram.com/reel')) score += MS_POR_HORA * 4;
  if (item.fromSerper) score += MS_POR_HORA * 10;
  if (RUIDO_REDES_SOCIAIS.some((r) => texto.includes(r))) score -= MS_POR_DIA * 5;

  return score;
}

function montarConsultasRedesSociais(palavraChave, dias = 1) {
  const termoBase = palavraChave.trim();
  const termo = termoParaConsultaRede(termoBase);
  const termoAspas = termo.includes(' ') ? `"${termo}"` : termo;
  const termoGospel = `${termoBase} gospel`;
  const termoGospelAspas = `"${termoBase}" gospel`;
  const fresh = freshnessBrave(dias);
  const c = (q, rede, limite) => ({ q, rede, limite, fresh });

  return [
    c(`site:instagram.com/p ${termoGospelAspas}`, 'Instagram', 15),
    c(`site:instagram.com/reel ${termoGospelAspas}`, 'Instagram', 15),
    c(`site:instagram.com/reel ${termoGospel} louvor`, 'Instagram', 12),
    c(`site:instagram.com/p ${termoGospel} igreja`, 'Instagram', 12),
    c(`site:instagram.com ${termoGospel} (cantora OR cantor OR igreja)`, 'Instagram', 10),
    c(`site:instagram.com ${termoGospelAspas} adoração`, 'Instagram', 10),
    c(`site:instagram.com ${termoGospel} testemunho`, 'Instagram', 8),
    c(`site:facebook.com ${termoGospelAspas}`, 'Facebook', 12),
    c(`site:facebook.com/posts ${termoGospel} louvor`, 'Facebook', 12),
    c(`site:facebook.com/reel ${termoGospelAspas}`, 'Facebook', 10),
    c(`site:facebook.com/watch ${termoGospel} igreja`, 'Facebook', 10),
    c(`site:facebook.com/groups ${termoGospelAspas}`, 'Facebook', 8),
    c(`site:facebook.com ${termoGospel} evangélico`, 'Facebook', 8),
    c(`(site:twitter.com OR site:x.com) ${termoGospelAspas}`, 'X (Twitter)', 12),
    c(`(site:twitter.com OR site:x.com) ${termoGospel} (louvor OR igreja)`, 'X (Twitter)', 10),
    c(`(site:twitter.com OR site:x.com) ${termoGospelAspas} brasil`, 'X (Twitter)', 8),
    c(`site:threads.net ${termoGospelAspas}`, 'Threads', 8),
    c(`site:threads.net ${termoGospel} igreja`, 'Threads', 6),
    c(`site:tiktok.com ${termoGospelAspas}`, 'TikTok', 10),
    c(`site:tiktok.com ${termoGospel} pastor igreja`, 'TikTok', 8),
    c(`site:youtube.com/shorts ${termoGospelAspas}`, 'YouTube', 8),
    c(`site:youtube.com/watch ${termoGospel} louvor`, 'YouTube', 8),
    c(`site:linkedin.com/posts ${termoGospelAspas}`, 'LinkedIn', 5),
    c(`site:pinterest.com ${termoGospel} louvor`, 'Pinterest', 5),
    c(`site:kwai.com ${termoGospelAspas}`, 'Kwai', 5),
    c(`site:reddit.com ${termoGospelAspas} brasil`, 'Reddit', 5)
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
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  if (lower.includes('pinterest.com')) return 'Pinterest';
  if (lower.includes('kwai.com')) return 'Kwai';
  if (lower.includes('reddit.com')) return 'Reddit';
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
  const termoGospel = termoParaConsultaRede(palavraChave);
  const query = encodeURIComponent(`site:${site} ${termoGospel} when:${dias}d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const rede = site.includes('instagram') ? 'Instagram'
      : site.includes('facebook') ? 'Facebook'
        : (site.includes('twitter') || site.includes('x.com')) ? 'X (Twitter)'
          : site.includes('threads') ? 'Threads'
            : site.includes('tiktok') ? 'TikTok'
              : site.includes('youtube') ? 'YouTube'
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

async function buscarBraveWeb(query, palavraChave, limite = 5, {
  freshness = 'pw',
  fonteLabel = null,
  somenteRede = false,
  searchLang = 'pt-br'
} = {}) {
  if (!braveDisponivel()) return [];

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(Math.max(limite + 5, 10), 20)),
      country: searchLang === 'en' ? 'US' : 'BR',
      freshness
    });
    if (searchLang) {
      params.set('search_lang', searchLang);
      params.set('ui_lang', searchLang === 'en' ? 'en-US' : 'pt-BR');
    }
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
      const titulo = limparTitulo(item.title || '');
      const resumo = limparResumo(item.description || '', rede ? 600 : 400);
      const conteudoRede = rede
        ? limparResumo(`${titulo} ${item.description || ''}`, 800)
        : undefined;
      return {
        titulo,
        link: item.url,
        resumo,
        conteudoRede,
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

async function buscarPortaisGospel(palavraChave, limite = 5, dias = 5, { ampliado = false } = {}) {
  const fresh = freshnessBrave(dias);
  const sites = ampliado ? PORTAIS_GOSPEL : PORTAIS_GOSPEL.slice(0, 6);
  const porSite = ampliado ? 3 : 2;

  const lotesBrave = braveDisponivel()
    ? await Promise.all(
      sites.map((site) =>
        buscarBraveWeb(
          `site:${site} ${palavraChave} gospel OR evangélico OR igreja OR louvor`,
          palavraChave,
          porSite,
          { freshness: fresh, fonteLabel: site.replace(/^www\./, '') }
        )
      )
    )
    : [];

  const lotesGoogle = await Promise.all(
    sites.slice(0, ampliado ? sites.length : 4).map((site) =>
      buscarGoogleNewsSite(site, palavraChave, porSite, dias)
    )
  );

  return [...lotesBrave.flat(), ...lotesGoogle.flat()]
    .map((item) => ({ ...item, tipoFonte: 'portal_gospel' }))
    .slice(0, ampliado ? limite * 2 : limite);
}

async function buscarWebGospel(palavraChave, limite = 5, dias = 5, { ampliado = false } = {}) {
  const fresh = freshnessBrave(dias);
  const consultas = [
    `${palavraChave} gospel brasil notícia polêmica pastor igreja`,
    `${palavraChave} evangélico repercussão redes sociais`,
    `"${palavraChave}" gospel breaking news brasil`,
    `${palavraChave} cantor gospel polêmica hoje`,
    `${palavraChave} igreja evangélica notícia recente`,
    `${palavraChave} pastor pastora declaração gospel`
  ];
  const lista = ampliado ? consultas : consultas.slice(0, 3);
  const porConsulta = ampliado ? Math.ceil(limite / 2) : Math.ceil(limite / 2);

  const lotes = await Promise.all(
    lista.map((q) => buscarBraveWeb(q, palavraChave, porConsulta, { freshness: fresh, fonteLabel: 'Web gospel' }))
  );

  return lotes.flat().slice(0, ampliado ? limite * 2 : limite);
}

async function buscarGoogleNewsInternacional(palavraChave, limite = 6, dias = 1) {
  const consultas = [
    `${palavraChave} christian gospel news when:${dias}d`,
    `${palavraChave} evangelical church worship when:${dias}d`,
    `${palavraChave} gospel singer pastor when:${dias}d`
  ];
  const resultados = [];

  for (const base of consultas) {
    const query = encodeURIComponent(base);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const xml = await res.text();
      extrairItensRss(xml)
        .filter((item) => itemEhRecente(item, dias === 1 ? '24h' : dias))
        .forEach((item) => {
          if (!itemQualidadeValida(item)) return;
          resultados.push({
            ...item,
            nicho: palavraChave,
            fonte: 'Google News — Internacional',
            fonteInternacional: true,
            tipoFonte: 'internacional',
            recente: true
          });
        });
    } catch {
      /* ignore */
    }
  }

  return resultados.slice(0, limite);
}

async function buscarConteudoInternacional(palavraChave, limite = 10, dias = 1) {
  const fresh = freshnessBrave(dias);
  const termo = palavraChave.trim();
  const consultas = [
    { q: `${termo} christian gospel news`, limite: 6 },
    { q: `${termo} evangelical church worship news`, limite: 6 },
    { q: `site:christianpost.com ${termo}`, limite: 4 },
    { q: `site:christianitytoday.com ${termo}`, limite: 4 },
    { q: `site:religionnews.com ${termo}`, limite: 4 },
    { q: `${termo} gospel news international`, limite: 5 },
    { q: `${termo} noticias evangelicas iglesia`, limite: 5 },
    { q: `${termo} música gospel internacional`, limite: 4, lang: 'pt-br' }
  ];

  const vistos = new Set();
  const candidatos = [];

  const lotes = await Promise.all(
    consultas.map((c) =>
      buscarBraveWeb(c.q, palavraChave, c.limite, {
        freshness: fresh,
        fonteLabel: 'Internacional',
        searchLang: c.lang || 'en'
      })
    )
  );

  for (const item of lotes.flat()) {
    if (!item?.link || vistos.has(item.link)) continue;
    vistos.add(item.link);
    candidatos.push({
      ...item,
      fonteInternacional: true,
      tipoFonte: 'internacional',
      fonte: item.fonte || 'Internacional'
    });
  }

  const googleInt = await buscarGoogleNewsInternacional(palavraChave, Math.ceil(limite / 2), dias);
  for (const item of googleInt) {
    if (!item?.link || vistos.has(item.link)) continue;
    vistos.add(item.link);
    candidatos.push(item);
  }

  return candidatos.slice(0, limite);
}

async function buscarRedesSociais(palavraChave, limite = 6, periodo = 1, { modoAmpliado = false, conteudoInternacional = false } = {}) {
  const cfg = typeof periodo === 'object' && periodo !== null
    ? periodo
    : normalizarPeriodo(periodo);
  const dias = cfg.diasGoogle || cfg.diasBrave || cfg.dias || 1;
  const fresh = freshnessBrave(dias);
  const consultas = montarConsultasRedesSociais(palavraChave, dias);
  const vistos = new Set();
  const candidatos = [];

  const consultasExtras = conteudoInternacional ? [
    { q: `site:instagram.com/p "${palavraChave}" worship christian`, rede: 'Instagram', limite: 8, fresh, lang: 'en' },
    { q: `site:instagram.com/reel ${palavraChave} worship`, rede: 'Instagram', limite: 6, fresh, lang: 'en' },
    { q: `(site:twitter.com OR site:x.com) ${palavraChave} christian gospel worship`, rede: 'X (Twitter)', limite: 8, fresh, lang: 'en' },
    { q: `site:facebook.com ${palavraChave} christian church`, rede: 'Facebook', limite: 6, fresh, lang: 'en' }
  ] : [];

  const serperItens = await buscarSerperRedesSociais(palavraChave, cfg, { limitePorConsulta: modoAmpliado ? 18 : 15 });
  for (const item of serperItens) {
    if (!item?.link || vistos.has(item.link)) continue;
    if (!itemRelevanteRedeSocial(item, palavraChave)) continue;
    if (!itemEhRecente(item, cfg)) continue;
    vistos.add(item.link);
    candidatos.push(item);
  }

  const lotesBrave = await Promise.all([
    ...consultas.map((c) =>
      buscarBraveWeb(c.q, palavraChave, c.limite, {
        freshness: c.fresh || fresh,
        fonteLabel: c.rede,
        somenteRede: true
      })
    ),
    ...consultasExtras.map((c) =>
      buscarBraveWeb(c.q, palavraChave, c.limite, {
        freshness: c.fresh,
        fonteLabel: c.rede,
        somenteRede: true,
        searchLang: c.lang || 'en'
      }).then((itens) => itens.map((i) => ({ ...i, fonteInternacional: true })))
    )
  ]);

  for (const item of lotesBrave.flat()) {
    if (!item?.link || vistos.has(item.link)) continue;
    if (!itemRelevanteRedeSocial(item, palavraChave)) continue;
    if (!itemEhRecente(item, cfg)) continue;
    vistos.add(item.link);
    candidatos.push(item);
  }

  const porFonteGoogle = modoAmpliado ? 8 : 5;
  const googleLotes = await Promise.all([
    buscarGoogleNewsSite('instagram.com', palavraChave, porFonteGoogle, dias),
    buscarGoogleNewsSite('facebook.com', palavraChave, porFonteGoogle, dias),
    buscarGoogleNewsSite('twitter.com', palavraChave, porFonteGoogle, dias),
    buscarGoogleNewsSite('x.com', palavraChave, Math.max(4, porFonteGoogle - 1), dias),
    buscarGoogleNewsSite('threads.net', palavraChave, Math.max(4, porFonteGoogle - 2), dias),
    buscarGoogleNewsSite('tiktok.com', palavraChave, Math.max(4, porFonteGoogle - 2), dias),
    buscarGoogleNewsSite('youtube.com', palavraChave, Math.max(4, porFonteGoogle - 2), dias)
  ]);

  for (const item of googleLotes.flat()) {
    if (!item?.link || vistos.has(item.link)) continue;
    if (!itemRelevanteRedeSocial(item, palavraChave)) continue;
    if (!itemEhRecente(item, cfg)) continue;
    vistos.add(item.link);
    candidatos.push({
      ...item,
      conteudoRede: limparResumo(`${item.titulo || ''} ${item.resumo || ''}`, 800)
    });
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
    diasRecentes = '24h',
    conteudoInternacional = false,
    incluirGoogleTrends = true,
    buscaAmpliada = false
  } = opcoes;
  const periodo = normalizarPeriodo(diasRecentes);
  const diasBusca = periodo.diasGoogle || periodo.diasBrave || 1;
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!termos.length) throw new Error('Informe ao menos uma palavra-chave ou nicho.');

  const resultados = [];
  const qtdBase = buscaAmpliada ? quantidadePorNicho + 4 : quantidadePorNicho;
  const maxRedesPorTermo = somenteRedesSociais
    ? Math.max(quantidadePorNicho * (buscaAmpliada ? 3 : 2), buscaAmpliada ? 14 : 10)
    : (buscaAmpliada
      ? Math.max(10, quantidadePorNicho)
      : Math.max(6, Math.ceil(quantidadePorNicho * 0.75)));

  const adicionar = (item, termoOrigem) => {
    if (!item?.titulo) return;
    const termoRef = termoOrigem || item.nicho;
    const ehRede = item.tipoFonte === 'rede_social' || item.redeSocial;
    if (ehRede && !itemRelevanteRedeSocial(item, termoRef)) return;
    if (somenteRedesSociais && !itemRelevanteRedeSocial(item, termoRef)) return;
    if (!itemQualidadeValida(item)) return;
    if (somenteRecentes && !itemEhRecente(item, periodo)) return;

    const dup = resultados.find((r) => {
      const linkA = r.linkOriginal || r.link;
      const linkB = item.linkOriginal || item.link;
      if (linkA && linkB && linkA === linkB) return true;
      if (somenteRedesSociais || ehRede) {
        return titulosSimilares(r.titulo, item.titulo);
      }
      return fatosSimilares(r.titulo, item.titulo, r.resumo, item.resumo);
    });
    if (dup) {
      if (item.emAlta && !dup.emAlta) dup.emAlta = true;
      if ((item.resumo || '').length > (dup.resumo || '').length) dup.resumo = item.resumo;
      if ((item.conteudoRede || '').length > (dup.conteudoRede || '').length) dup.conteudoRede = item.conteudoRede;
      if (!dup.redeSocial && item.redeSocial) dup.redeSocial = item.redeSocial;
      return;
    }
    if (item.link && resultados.some((r) => (r.linkOriginal || r.link) === item.link)) return;

    resultados.push({
      id: `topic-${resultados.length + 1}`,
      ...item,
      linkOriginal: item.linkOriginal || item.link,
      recente: somenteRecentes
    });
  };

  for (const termo of termos) {
    try {
      let promessas;

      if (somenteRedesSociais) {
        promessas = [
          buscarRedesSociais(termo, Math.max(quantidadePorNicho * (buscaAmpliada ? 12 : 8), 40), periodo, {
            modoAmpliado: true,
            conteudoInternacional
          })
        ];
      } else {
        promessas = [
          buscarBraveNews(termo, qtdBase + 6, diasBusca),
          buscarEmAlta(termo, buscaAmpliada ? 8 : 4),
          buscarGoogleNews24h(termo, buscaAmpliada ? 8 : 4),
          buscarGoogleNews(termo, qtdBase + 4, { dias: diasBusca }),
          buscarPortaisGospel(termo, buscaAmpliada ? 12 : 6, diasBusca, { ampliado: buscaAmpliada }),
          buscarWebGospel(termo, buscaAmpliada ? 12 : 6, diasBusca, { ampliado: buscaAmpliada })
        ];

        if (incluirRedesSociais) {
          promessas.push(buscarRedesSociais(termo, maxRedesPorTermo, periodo, {
            modoAmpliado: buscaAmpliada || true,
            conteudoInternacional
          }));
        }

        if (conteudoInternacional) {
          promessas.push(buscarConteudoInternacional(termo, Math.max(quantidadePorNicho * (buscaAmpliada ? 3 : 2), 10), diasBusca));
        }

        if (incluirGoogleTrends) {
          promessas.push(buscarGoogleTrends(termo, Math.max(buscaAmpliada ? 6 : 3, Math.ceil(quantidadePorNicho / 2))));
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

  const multiplicador = somenteRedesSociais ? (buscaAmpliada ? 8 : 5) : (buscaAmpliada ? 3 : 2);
  const limiteFinal = Math.min(resultados.length, termos.length * quantidadePorNicho * multiplicador);
  const selecionados = resultados.slice(0, limiteFinal);

  if (!selecionados.length) {
    if (!somenteRedesSociais) {
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
    return [];
  }

  if (somenteRedesSociais) {
    return deduplicarTopicos(selecionados, { modoRedes: true })
      .filter((item) => itemQualidadeValida(item))
      .filter((item) => itemRelevanteRedeSocial(item, item.nicho))
      .filter((item) => !somenteRecentes || itemEhRecente(item, periodo))
      .slice(0, termos.length * quantidadePorNicho * 5);
  }

  const limiteApuracao = Math.min(selecionados.length, 14);
  const apurados = await Promise.all(
    selecionados.slice(0, limiteApuracao).map((item) => apurarTopico(item))
  );

  const finais = deduplicarTopicos([...apurados, ...selecionados.slice(limiteApuracao)], {
    modoRedes: somenteRedesSociais
  })
    .filter((item) => itemQualidadeValida(item))
    .filter((item) => !somenteRedesSociais || itemRelevanteRedeSocial(item, item.nicho))
    .filter((item) => !somenteRecentes || itemEhRecente(item, periodo) || item.fonte === 'Pauta editorial');

  return finais.slice(0, termos.length * quantidadePorNicho * (somenteRedesSociais ? 5 : 2));
}

module.exports = {
  pesquisarNichos,
  buscarGoogleNews,
  buscarBraveNews,
  buscarRedesSociais,
  buscarPortaisGospel,
  buscarWebGospel,
  buscarBraveWeb,
  apurarTopico,
  itemEhRecente,
  itemQualidadeValida
};
