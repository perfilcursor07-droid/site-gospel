const { buscarNoticias, buscarWeb } = require('./braveSearch');
const { braveDisponivel } = require('./braveApi');

const USER_AGENT = 'SiteGospelBot/1.0 (+https://gitlab.com/perfilcursor07-group/obuxixo)';

const CONTEXTO_GOSPEL = /gospel|evangel|igreja|louvor|pastor|pastora|cantor|cantora|adora|louvou|culto|crist[aã]o|biblia|bíblia|worship|hino|prega|congresso|testemunho|adoração|adoracao|jesus|deus|oracao|oração|fe|fé|ministerio|ministério/i;

function parseJsonTrends(texto) {
  const limpo = String(texto || '').replace(/^\)\]\}',?\s*/, '').trim();
  if (!limpo || limpo.startsWith('<')) return null;
  try {
    return JSON.parse(limpo);
  } catch {
    return null;
  }
}

function normalizarTermoTrends(termo) {
  return String(termo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function termoCombinaBusca(query, palavraChave) {
  const q = normalizarTermoTrends(query);
  const termos = String(palavraChave || '')
    .split(/[\s,;+/]+/)
    .map(normalizarTermoTrends)
    .filter((t) => t.length > 2);

  if (!termos.length) return CONTEXTO_GOSPEL.test(q);
  if (termos.some((t) => q.includes(t) || t.includes(q))) return true;
  return CONTEXTO_GOSPEL.test(q);
}

function extrairTrendsDiarios(json) {
  const dias = json?.default?.trendingSearchesDays || [];
  const itens = [];

  for (const dia of dias) {
    for (const busca of dia.trendingSearches || []) {
      const query = busca.title?.query
        || busca.title?.exploreLink?.match(/q=([^&]+)/)?.[1]?.replace(/\+/g, ' ');
      if (!query) continue;

      const artigos = (busca.articles || [])
        .map((a) => a.title || a.snippet)
        .filter(Boolean)
        .slice(0, 2);

      itens.push({
        query: decodeURIComponent(String(query).replace(/\+/g, ' ')),
        artigos,
        trafego: busca.formattedTraffic || null
      });
    }
  }

  return itens;
}

async function buscarTrendsDiariosBrasil() {
  const url = 'https://trends.google.com/trends/api/dailytrends?hl=pt-BR&tz=-180&geo=BR&ns=15';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const json = parseJsonTrends(await res.text());
    return extrairTrendsDiarios(json);
  } catch {
    return [];
  }
}

async function buscarNoticiaGoogleNews(query) {
  const q = encodeURIComponent(`${query} gospel OR evangélico when:3d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const bloco = xml.match(/<item[\s\S]*?<\/item>/i);
    if (!bloco) return null;
    const titulo = bloco[0].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
    const link = bloco[0].match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    if (!titulo) return null;
    return { titulo: titulo.replace(/<[^>]+>/g, '').trim(), link };
  } catch {
    return null;
  }
}

async function buscarTrendsViaGoogleNews(palavraChave, limite) {
  const termo = palavraChave.trim();
  const consultas = [
    `${termo} gospel em alta`,
    `${termo} louvor viral`,
    `${termo} pastor polêmica gospel`,
    `assunto em alta ${termo} evangélico`
  ];

  const vistos = new Set();
  const candidatos = [];

  for (const q of consultas) {
    const noticia = await buscarNoticiaGoogleNews(q);
    if (!noticia || vistos.has(noticia.link)) continue;
    if (!termoCombinaBusca(noticia.titulo, palavraChave)) continue;
    vistos.add(noticia.link);

    candidatos.push({
      titulo: noticia.titulo.slice(0, 200),
      resumo: `Notícia em alta relacionada a ${termo} — apuração a partir de buscas e tendências gospel.`,
      link: noticia.link,
      nicho: palavraChave,
      fonte: 'Google Trends',
      emAlta: true,
      tipoFonte: 'trends',
      dataTimestamp: Date.now(),
      recente: true
    });

    if (candidatos.length >= limite) break;
  }

  return candidatos;
}

async function buscarTrendsViaBrave(palavraChave, limite) {
  if (!braveDisponivel()) return [];

  const termo = palavraChave.trim();
  const consultas = [
    `${termo} gospel em alta brasil`,
    `${termo} viral igreja louvor`,
    `assunto em alta ${termo} evangélico`,
    `google trends ${termo} gospel`,
    `${termo} polêmica gospel hoje`
  ];

  const vistos = new Set();
  const candidatos = [];

  for (const q of consultas) {
    const [news, web] = await Promise.all([
      buscarNoticias(q, { count: 5, freshness: 'pd' }),
      buscarWeb(q, { count: 4, freshness: 'pd' })
    ]);

    for (const item of [...news, ...web]) {
      const titulo = item.titulo?.trim();
      const link = item.link;
      if (!titulo || !link || vistos.has(link)) continue;
      if (!termoCombinaBusca(titulo, palavraChave)) continue;
      vistos.add(link);

      candidatos.push({
        titulo,
        resumo: (item.resumo || `Assunto em alta sobre ${termo} no meio gospel brasileiro.`).slice(0, 380),
        link,
        nicho: palavraChave,
        fonte: 'Google Trends',
        emAlta: true,
        tipoFonte: 'trends',
        dataTimestamp: Date.now(),
        recente: true
      });

      if (candidatos.length >= limite) return candidatos;
    }
  }

  return candidatos;
}

async function buscarGoogleTrends(palavraChave, limite = 5) {
  const vistos = new Set();
  const candidatos = [];

  const adicionar = async (query, extras = {}) => {
    const q = String(query || '').trim();
    if (!q || q.length < 3 || vistos.has(q.toLowerCase())) return;
    if (!termoCombinaBusca(q, palavraChave) && !extras.forcar) return;
    vistos.add(q.toLowerCase());

    let titulo = extras.titulo;
    let link = extras.link || `https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}&geo=BR`;

    if (!titulo) {
      const noticia = await buscarNoticiaGoogleNews(q);
      if (noticia) {
        titulo = noticia.titulo;
        link = noticia.link || link;
      }
    }

    if (!titulo) {
      titulo = extras.artigos?.[0] || `${q}: termo em alta no Google Trends`;
    }

    const resumo = extras.resumo
      || (extras.trafego
        ? `Busca em alta no Google Trends (${extras.trafego}) — apuração sobre ${q} no meio gospel.`
        : `Termo em alta relacionado a ${palavraChave} — fonte Google Trends / buscas em alta.`);

    candidatos.push({
      titulo: titulo.slice(0, 200),
      resumo: resumo.slice(0, 380),
      link,
      nicho: palavraChave,
      fonte: 'Google Trends',
      emAlta: true,
      tipoFonte: 'trends',
      termoTrends: q,
      dataTimestamp: Date.now(),
      recente: true
    });
  };

  try {
    const diarios = await buscarTrendsDiariosBrasil();
    for (const t of diarios.filter((d) => termoCombinaBusca(d.query, palavraChave)).slice(0, limite)) {
      await adicionar(t.query, { artigos: t.artigos, trafego: t.trafego });
    }
  } catch (e) {
    console.warn('Google Trends API:', e.message);
  }

  if (candidatos.length < limite) {
    const brave = braveDisponivel()
      ? await buscarTrendsViaBrave(palavraChave, limite - candidatos.length)
      : await buscarTrendsViaGoogleNews(palavraChave, limite - candidatos.length);
    for (const item of brave) {
      const chave = (item.link || item.titulo || '').toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      candidatos.push(item);
    }
  }

  return candidatos.slice(0, limite);
}

module.exports = { buscarGoogleTrends, termoCombinaBusca };
