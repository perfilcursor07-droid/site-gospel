const {
  pesquisarNichos,
  apurarTopico,
  buscarBraveNews,
  buscarGoogleNews,
  buscarWebGospel,
  buscarRedesSociais,
  buscarPortaisGospel
} = require('./newsResearch');
const { titulosSimilares } = require('../utils/topicMatch');

const MAX_FONTES_APURAR = 10;
const MAX_FONTES_CONTEXTO = 15;
const MIN_FONTES_IDEAIS = 3;

const STOP_TERMOS_INVEST = new Set([
  'gospel', 'evangelico', 'igreja', 'brasil', 'noticia', 'noticias', 'portal',
  'vc', 'voce', 'você', 'nao', 'não', 'sabia', 'que', 'com', 'para', 'uma',
  'the', 'and', 'sobre', 'mais', 'como', 'seu', 'sua', 'dos', 'das', 'nos'
]);

function extrairTermosInvestigativa(palavrasChave) {
  return String(palavrasChave || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[\s,;\n+/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_TERMOS_INVEST.has(t));
}

function textoItemInvestigativa(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.conteudoRede || ''} ${item.nicho || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function termoApareceNoTexto(texto, termo) {
  if (!termo || !texto) return false;
  if (texto.includes(termo)) return true;
  if (termo.length > 4 && termo.endsWith('s') && texto.includes(termo.slice(0, -1))) return true;
  if (termo.length > 4 && !termo.endsWith('s') && texto.includes(`${termo}s`)) return true;
  return false;
}

function contarTermosNoItem(item, termos) {
  const texto = textoItemInvestigativa(item);
  return termos.filter((t) => termoApareceNoTexto(texto, t)).length;
}

function itemRelevanteParaPauta(item, palavrasChave) {
  const termos = extrairTermosInvestigativa(palavrasChave);
  if (!termos.length) return true;
  const hits = contarTermosNoItem(item, termos);
  const minHits = termos.length <= 2 ? 1 : Math.max(2, Math.ceil(termos.length * 0.34));
  return hits >= minHits;
}

function normalizarPalavrasChave(palavrasChave) {
  const texto = String(palavrasChave || '').trim();
  if (!texto) throw new Error('Informe as palavras-chave da matéria investigativa.');
  if (texto.length < 3) throw new Error('Palavras-chave muito curtas. Descreva melhor o assunto.');
  return texto;
}

function deduplicarFontesApuracao(fontes) {
  const vistos = new Set();
  return (fontes || []).filter((f) => {
    const url = (f.url || '').toLowerCase().replace(/\/$/, '');
    const titulo = (f.titulo || '').toLowerCase().slice(0, 80);
    const chave = url || titulo;
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  }).slice(0, MAX_FONTES_CONTEXTO);
}

function pontuarRelevanciaInvestigativa(item, palavrasChave) {
  const termos = extrairTermosInvestigativa(palavrasChave);
  const texto = textoItemInvestigativa(item);
  let score = 0;
  for (const termo of termos) {
    if (termoApareceNoTexto(texto, termo)) {
      score += termo.length >= 6 ? 5 : 3;
    }
  }
  if (item.emAlta) score += 1;
  if (item.redeSocial || item.tipoFonte === 'rede_social') score += 1;
  if ((item.resumo || '').length > 80) score += 1;
  return score;
}

function montarContextoInvestigativo(palavrasChave, apurados) {
  const linhas = [
    `TEMA OBRIGATÓRIO (não mude de assunto): ${palavrasChave}`,
    `Objetivo: matéria original com furo de reportagem cruzando ${apurados.length} fontes SOBRE ESTE TEMA.`,
    'INSTRUÇÃO: Use apenas fatos das fontes que tratam do tema acima. Ignore assuntos não relacionados presentes nos links.',
    'Reescreva 100% com palavras próprias — nunca copie frases literais.',
    ''
  ];

  apurados.forEach((fonte, i) => {
    const veiculo = fonte.redeSocial || fonte.veiculo || fonte.fonte || 'Web';
    linhas.push(`=== Fonte ${i + 1}: ${fonte.titulo || 'Sem título'} (${veiculo}) ===`);
    if (fonte.resumo) linhas.push(`Contexto: ${fonte.resumo}`);
    if (fonte.contextoApuracao) {
      linhas.push(fonte.contextoApuracao.slice(0, 2200));
    } else if (fonte.fontesApuracao?.length) {
      fonte.fontesApuracao.forEach((f) => {
        if (f.trecho) linhas.push(`Trecho apurado: ${f.trecho.slice(0, 900)}`);
        if (f.resumo && f.resumo !== fonte.resumo) linhas.push(`Resumo: ${f.resumo.slice(0, 400)}`);
      });
    }
    if (fonte.link) linhas.push(`URL: ${fonte.link}`);
    linhas.push('');
  });

  return linhas.join('\n').slice(0, 14000);
}

function montarTituloPauta(palavrasChave) {
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const principal = termos[0] || palavrasChave;
  const extra = termos.slice(1, 3).join(', ');
  return extra
    ? `Apuração: ${principal} — ${extra}`
    : `Apuração investigativa: ${principal}`;
}

async function buscarFontesInvestigativa(palavrasChave, opcoes = {}) {
  const {
    diasRecentes = '7',
    conteudoInternacional = true,
    incluirRedesSociais = true
  } = opcoes;

  const diasBusca = diasRecentes === 'tudo' ? 14 : (parseInt(diasRecentes, 10) || (diasRecentes === '24h' ? 1 : 7));
  const periodo = diasRecentes === 'tudo' ? { dias: 14 } : diasRecentes;

  const [topicosNichos, brave, google, web, portais, redes] = await Promise.all([
    pesquisarNichos(palavrasChave, 10, {
      incluirRedesSociais,
      somenteRedesSociais: false,
      somenteRecentes: diasRecentes !== 'tudo',
      diasRecentes,
      conteudoInternacional,
      incluirGoogleTrends: false,
      buscaAmpliada: true
    }),
    buscarBraveNews(palavrasChave, 14, diasBusca).catch(() => []),
    buscarGoogleNews(palavrasChave, 12, { dias: diasBusca }).catch(() => []),
    buscarWebGospel(palavrasChave, 12, diasBusca, { ampliado: true }).catch(() => []),
    buscarPortaisGospel(palavrasChave, 10, diasBusca, { ampliado: true }).catch(() => []),
    incluirRedesSociais
      ? buscarRedesSociais(palavrasChave, 12, periodo, { modoAmpliado: true, conteudoInternacional }).catch(() => [])
      : Promise.resolve([])
  ]);

  const brutos = [...topicosNichos, ...brave, ...google, ...web, ...portais, ...redes];
  const unicos = [];

  for (const item of brutos) {
    if (!item?.titulo) continue;
    if (unicos.some((u) => titulosSimilares(u.titulo, item.titulo))) continue;
    unicos.push(item);
  }

  const relevantes = unicos
    .filter((item) => itemRelevanteParaPauta(item, palavrasChave))
    .sort((a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave) - pontuarRelevanciaInvestigativa(a, palavrasChave));

  let selecionados = relevantes.slice(0, MAX_FONTES_APURAR);

  if (selecionados.length < MIN_FONTES_IDEAIS) {
    const fallback = unicos
      .filter((item) => contarTermosNoItem(item, extrairTermosInvestigativa(palavrasChave)) >= 1)
      .sort((a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave) - pontuarRelevanciaInvestigativa(a, palavrasChave));
    for (const item of fallback) {
      if (selecionados.length >= MAX_FONTES_APURAR) break;
      if (selecionados.some((s) => titulosSimilares(s.titulo, item.titulo))) continue;
      selecionados.push(item);
    }
  }

  if (!selecionados.length) {
    throw new Error(
      `Nenhuma fonte encontrada sobre "${palavrasChave}". Tente termos mais específicos (nomes, eventos) ou amplie o período.`
    );
  }

  return selecionados;
}

async function apurarPautaInvestigativa(palavrasChave, opcoes = {}) {
  const chave = normalizarPalavrasChave(palavrasChave);
  const fontesBrutas = await buscarFontesInvestigativa(chave, opcoes);

  const apurados = await Promise.all(
    fontesBrutas.map((item) => apurarTopico(item))
  );

  const todasFontes = deduplicarFontesApuracao(
    apurados.flatMap((a) => a.fontesApuracao || [])
  );

  const contextoApuracao = montarContextoInvestigativo(chave, apurados);
  const tituloPauta = montarTituloPauta(chave);

  return {
    palavrasChave: chave,
    titulo: tituloPauta,
    resumo: `Matéria investigativa sobre "${chave}" com base em ${apurados.length} fontes apuradas (portais, notícias, redes sociais e web).`,
    link: apurados[0]?.link || null,
    nicho: chave.split(/[,;]+/)[0]?.trim() || chave,
    contextoApuracao,
    fontesApuracao: todasFontes,
    fontesResumo: apurados.map((a) => ({
      titulo: a.titulo,
      veiculo: a.redeSocial || a.veiculo || a.fonte || 'Web',
      url: a.link,
      redeSocial: !!a.redeSocial
    })),
    redeSocial: apurados.some((a) => a.redeSocial || a.tipoFonte === 'rede_social'),
    fonteInternacional: apurados.some((a) => a.fonteInternacional),
    contagemFontes: apurados.length
  };
}

module.exports = {
  apurarPautaInvestigativa,
  buscarFontesInvestigativa,
  normalizarPalavrasChave
};
