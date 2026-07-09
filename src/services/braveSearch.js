const { marcarRespostaBrave, marcarRespostaBraveOk, braveDisponivel } = require('./braveApi');

const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map();

function lerCache(chave) {
  const item = cache.get(chave);
  if (!item || Date.now() > item.expira) {
    cache.delete(chave);
    return null;
  }
  return item.dados;
}

function salvarCache(chave, dados) {
  cache.set(chave, { dados, expira: Date.now() + CACHE_TTL_MS });
}

async function requisicaoBrave(endpoint, params) {
  if (!braveDisponivel()) return null;

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/${endpoint}?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(14000)
    });

    if (!res.ok) {
      const erro = await res.text();
      marcarRespostaBrave(res, erro);
      return null;
    }

    marcarRespostaBraveOk();
    return res.json();
  } catch (e) {
    console.warn(`Brave ${endpoint}:`, e.message);
    return null;
  }
}

function extrairHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizarResultadoNews(item) {
  if (!item?.title || !item?.url) return null;
  return {
    titulo: item.title,
    link: item.url,
    resumo: item.description || '',
    veiculo: item.meta_url?.hostname?.replace(/^www\./, '') || extrairHostname(item.url),
    idade: item.age || null,
    thumbnail: item.thumbnail?.src || null
  };
}

function normalizarResultadoWeb(item) {
  if (!item?.title || !item?.url) return null;
  return {
    titulo: item.title,
    link: item.url,
    resumo: item.description || '',
    veiculo: extrairHostname(item.url),
    idade: item.age || null
  };
}

/**
 * Notícias recentes via Brave News API.
 */
async function buscarNoticias(query, { count = 10, freshness = 'pw' } = {}) {
  const q = (query || '').trim();
  if (!q) return [];

  const chave = `news:${q}:${freshness}:${count}`;
  const emCache = lerCache(chave);
  if (emCache) return emCache;

  const params = new URLSearchParams({
    q,
    count: String(Math.min(count, 20)),
    country: 'BR',
    search_lang: 'pt-br',
    freshness,
    spellcheck: '1'
  });

  const data = await requisicaoBrave('news/search', params);
  if (!data) return [];

  const resultados = (data.results || [])
    .map(normalizarResultadoNews)
    .filter(Boolean);

  salvarCache(chave, resultados);
  return resultados;
}

/**
 * Contexto pré-extraído para apuração / IA (LLM Context API).
 */
async function buscarContextoLlm(query, { maxTokens = 2800 } = {}) {
  const q = (query || '').trim();
  if (!q) return null;

  const chave = `llm:${q}:${maxTokens}`;
  const emCache = lerCache(chave);
  if (emCache) return emCache;

  const params = new URLSearchParams({
    q,
    maximum_number_of_tokens: String(maxTokens),
    context_threshold_mode: 'balanced'
  });

  const data = await requisicaoBrave('llm/context', params);
  if (!data) return null;

  let texto = '';

  if (typeof data.context === 'string') {
    texto = data.context;
  } else if (Array.isArray(data.results)) {
    texto = data.results
      .map((r) => r.content || r.text || r.snippet || r.description || '')
      .filter(Boolean)
      .join('\n\n');
  } else if (Array.isArray(data.grounding?.chunks)) {
    texto = data.grounding.chunks
      .map((c) => c.content || c.text || '')
      .filter(Boolean)
      .join('\n\n');
  } else if (Array.isArray(data.web?.results)) {
    texto = data.web.results
      .map((r) => [r.title, r.description].filter(Boolean).join(': '))
      .join('\n');
  }

  const resultado = texto.replace(/\s+/g, ' ').trim().slice(0, 4500) || null;
  if (resultado) salvarCache(chave, resultado);
  return resultado;
}

/**
 * Busca web pública (complemento à busca local).
 */
async function buscarWeb(query, { count = 8, freshness = 'pm' } = {}) {
  const q = (query || '').trim();
  if (!q) return [];

  const chave = `web:${q}:${freshness}:${count}`;
  const emCache = lerCache(chave);
  if (emCache) return emCache;

  const params = new URLSearchParams({
    q,
    count: String(Math.min(count, 20)),
    country: 'BR',
    search_lang: 'pt-br',
    freshness,
    spellcheck: '1'
  });

  const data = await requisicaoBrave('web/search', params);
  if (!data) return [];

  const resultados = (data.web?.results || [])
    .map(normalizarResultadoWeb)
    .filter(Boolean);

  salvarCache(chave, resultados);
  return resultados;
}

/** Assuntos em alta no meio gospel (últimas 24h). */
async function buscarEmAltaGospel(limite = 5) {
  return buscarNoticias('gospel evangélico igreja brasil', { count: limite, freshness: 'pd' });
}

/** Busca híbrida para a página /busca do site. */
async function buscarHibrida(termo, { limiteNoticias = 6, limiteWeb = 4 } = {}) {
  const q = (termo || '').trim();
  if (!q || q.length < 2) return { noticias: [], web: [] };

  const consulta = `${q} gospel evangélico brasil`;
  const [noticias, web] = await Promise.all([
    buscarNoticias(consulta, { count: limiteNoticias, freshness: 'pm' }),
    buscarWeb(consulta, { count: limiteWeb, freshness: 'pm' })
  ]);

  const vistos = new Set();
  const dedup = (lista) => lista.filter((item) => {
    if (!item.link || vistos.has(item.link)) return false;
    vistos.add(item.link);
    return true;
  });

  return {
    noticias: dedup(noticias),
    web: dedup(web).filter((w) => !noticias.some((n) => n.link === w.link))
  };
}

module.exports = {
  buscarNoticias,
  buscarContextoLlm,
  buscarWeb,
  buscarEmAltaGospel,
  buscarHibrida
};
