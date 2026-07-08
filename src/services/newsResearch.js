const { apurarTopico, decodificarHtml } = require('./articleSource');

const USER_AGENT = 'SiteGospelBot/1.0 (+https://gitlab.com/perfilcursor07-group/obuxixo)';

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
        titulo: decodificarHtml(titulo),
        link,
        resumo: descricao ? decodificarHtml(descricao).slice(0, 400) : '',
        data
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

async function buscarGoogleNews(palavraChave, limite = 5, extraQuery = '') {
  const base = extraQuery || `${palavraChave} gospel OR evangélico OR igreja OR cristão`;
  const query = encodeURIComponent(base);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return [];
  const xml = await res.text();
  return extrairItensRss(xml).slice(0, limite).map((item) => ({
    ...item,
    nicho: palavraChave,
    fonte: 'Google News'
  }));
}

async function buscarEmAlta(palavraChave, limite = 3) {
  const query = encodeURIComponent(`${palavraChave} when:7d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return [];
    const xml = await res.text();
    return extrairItensRss(xml).slice(0, limite).map((item) => ({
      ...item,
      nicho: palavraChave,
      fonte: 'Google News — em alta',
      emAlta: true
    }));
  } catch {
    return [];
  }
}

async function pesquisarNichos(palavrasChave, quantidadePorNicho = 5) {
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!termos.length) throw new Error('Informe ao menos uma palavra-chave ou nicho.');

  const resultados = [];
  const vistos = new Set();

  for (const termo of termos) {
    try {
      const [recentes, emAlta] = await Promise.all([
        buscarGoogleNews(termo, quantidadePorNicho),
        buscarEmAlta(termo, 2)
      ]);

      const itens = [...emAlta, ...recentes];
      for (const item of itens) {
        const chave = item.titulo.toLowerCase().slice(0, 80);
        if (!vistos.has(chave)) {
          vistos.add(chave);
          resultados.push({ id: `topic-${resultados.length + 1}`, ...item });
        }
      }
    } catch (e) {
      console.error(`Erro ao pesquisar "${termo}":`, e.message);
    }
  }

  resultados.sort((a, b) => parsearDataPub(b.data) - parsearDataPub(a.data));

  if (!resultados.length) {
    for (const termo of termos) {
      resultados.push({
        id: `sugestao-${resultados.length + 1}`,
        titulo: `Apuração: o que está em discussão sobre ${termo} no meio gospel`,
        resumo: `Levantamento de fatos, repercussão e contexto sobre ${termo} no cenário evangélico brasileiro.`,
        link: null,
        nicho: termo,
        fonte: 'Pauta editorial'
      });
    }
    return resultados;
  }

  const limiteApuracao = Math.min(resultados.length, 8);
  const apurados = await Promise.all(
    resultados.slice(0, limiteApuracao).map((item) => apurarTopico(item))
  );

  return [...apurados, ...resultados.slice(limiteApuracao)];
}

module.exports = { pesquisarNichos, buscarGoogleNews, apurarTopico };
