const {
  pesquisarNichos,
  apurarTopico,
  buscarBraveNews,
  buscarGoogleNews,
  buscarWebGospel,
  buscarRedesSociais,
  buscarPortaisGospel,
  buscarBraveWeb
} = require('./newsResearch');
const { buscarContextoLlm } = require('./braveSearch');
const { braveDisponivel } = require('./braveApi');
const { titulosSimilares } = require('../utils/topicMatch');

const MAX_FONTES_APURAR = 12;
const MAX_FONTES_CONTEXTO = 15;
const MIN_FONTES_IDEAIS = 3;

const STOP_TERMOS_INVEST = new Set([
  'gospel', 'evangelico', 'igreja', 'brasil', 'noticia', 'noticias', 'portal',
  'vc', 'voce', 'você', 'nao', 'não', 'sabia', 'que', 'com', 'para', 'uma',
  'the', 'and', 'sobre', 'mais', 'como', 'seu', 'sua', 'dos', 'das', 'nos',
  'eles', 'elas', 'quem', 'sao', 'são', 'voce', 'você', 'ja', 'já'
]);

const NOMES_FALSO_POSITIVO = new Set([
  'mateus', 'timoteo', 'timóteo', 'eclesiastes', 'deus', 'cristo', 'espirito',
  'santo', 'senhor', 'biblia', 'bíblia', 'igreja', 'brasil', 'gospel', 'louvor',
  'youtube', 'instagram', 'threads', 'tiktok', 'facebook', 'google', 'primeira',
  'carta', 'portanto', 'conforme', 'segundo', 'relatos', 'redes', 'sociais'
]);

function normalizarTextoBusca(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extrairTermosInvestigativa(palavrasChave) {
  return normalizarTextoBusca(palavrasChave)
    .split(/[\s,;\n+/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_TERMOS_INVEST.has(t));
}

function textoItemInvestigativa(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.conteudoRede || ''} ${item.nicho || ''}`;
}

function termoApareceNoTexto(texto, termo) {
  const t = normalizarTextoBusca(texto);
  const q = normalizarTextoBusca(termo);
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  if (q.length > 4 && q.endsWith('s') && t.includes(q.slice(0, -1))) return true;
  if (q.length > 4 && !q.endsWith('s') && t.includes(`${q}s`)) return true;
  return false;
}

function contarTermosNoItem(item, termos) {
  const texto = textoItemInvestigativa(item);
  return termos.filter((t) => termoApareceNoTexto(texto, t)).length;
}

function detectarFormatoInvestigativa(palavrasChave) {
  const t = normalizarTextoBusca(palavrasChave);
  if (/quem\s+(sao|são|e\s+ele|sao\s+ele)|que\s+sao\s+eles|lista\s+de|nomes\s+dos|nomes\s+de|quais\s+(sao|são)|voce\s+nao\s+sabia|você\s+não\s+sabia/.test(t)) {
    return 'listagem_nomes';
  }
  return 'reportagem';
}

function pautaMencionaDivorcio(palavrasChave) {
  return /divorci|divorcio|separou|separacao|separação|rompeu.*casamento|dissolucao|dissolução/.test(
    normalizarTextoBusca(palavrasChave)
  );
}

function itemMencionaDivorcio(item) {
  return /divorci|divorcio|separou|separacao|separação|dissolucao|dissolução|rompeu.*casamento|fim\s+do\s+casamento/.test(
    normalizarTextoBusca(textoItemInvestigativa(item))
  );
}

function itemPareceInternacionalIrrelevante(item, palavrasChave) {
  const link = (item.link || '').toLowerCase();
  const texto = normalizarTextoBusca(textoItemInvestigativa(item));
  const focoBrasil = /brasil|brasileir|evangelico\s+br/.test(normalizarTextoBusca(palavrasChave));
  if (!focoBrasil) return false;
  if (/venezuela|mexico|argentina|colombia|españa|spain|usa|united\s+states/.test(link + texto)) {
    if (!/brasil|brasileir/.test(texto)) return true;
  }
  return false;
}

function itemRelevanteParaPauta(item, palavrasChave, formato) {
  if (itemPareceInternacionalIrrelevante(item, palavrasChave)) return false;

  const termos = extrairTermosInvestigativa(palavrasChave);
  const hits = contarTermosNoItem(item, termos);
  const minHits = termos.length <= 2 ? 1 : Math.max(2, Math.ceil(termos.length * 0.3));

  if (pautaMencionaDivorcio(palavrasChave) && !itemMencionaDivorcio(item)) {
    const titulo = normalizarTextoBusca(item.titulo || '');
    if (!/pastor.*divorci|divorci.*pastor|pastores\s+que/.test(titulo)) return false;
  }

  if (formato === 'listagem_nomes') {
    const texto = normalizarTextoBusca(textoItemInvestigativa(item));
    const temPastor = /pastor|pastora|bispo|pregador|ministro\s+evangel/.test(texto);
    const temLista = /lista|quem\s+sao|que\s+voce\s+nao\s+sabia|nomes|famoss/.test(texto);
    if (temPastor && (itemMencionaDivorcio(item) || temLista)) return true;
    if (hits >= minHits && temPastor && itemMencionaDivorcio(item)) return true;
    return hits >= minHits + 1;
  }

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

function pontuarRelevanciaInvestigativa(item, palavrasChave, formato) {
  const termos = extrairTermosInvestigativa(palavrasChave);
  const texto = normalizarTextoBusca(textoItemInvestigativa(item));
  let score = 0;

  for (const termo of termos) {
    if (termoApareceNoTexto(texto, termo)) score += termo.length >= 6 ? 5 : 3;
  }

  if (formato === 'listagem_nomes') {
    if (/pastor|pastora/.test(texto) && itemMencionaDivorcio(item)) score += 8;
    if (/lista|quem\s+sao|nomes|famoss|voce\s+nao\s+sabia/.test(texto)) score += 6;
    if (item.tipoFonte === 'portal_gospel' || item.tipoFonte === 'noticia') score += 4;
    if (item.redeSocial && !/pastor\s+[a-z]|divorci/.test(texto)) score -= 6;
  }

  if (itemPareceInternacionalIrrelevante(item, palavrasChave)) score -= 20;
  if (item.tipoFonte === 'portal_gospel') score += 2;
  if ((item.resumo || '').length > 100) score += 1;

  return score;
}

function nomeValido(nome) {
  if (!nome || nome.length < 5) return false;
  const partes = normalizarTextoBusca(nome).split(/\s+/).filter(Boolean);
  if (partes.length < 2) return false;
  if (partes.some((p) => NOMES_FALSO_POSITIVO.has(p))) return false;
  if (partes.every((p) => p.length < 3)) return false;
  return true;
}

function extrairNomesDoTexto(texto) {
  const nomes = new Set();
  const bruto = String(texto || '');

  const padroes = [
    /pastor(?:a)?\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+(?:de|da|do|dos|das)\s+)?[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)/g,
    /(?:^|[\n.!?;])\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)\s+(?:se\s+)?divorciou/gi,
    /(?:^|[\n•\-–])\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)\s*[–—-]/g
  ];

  for (const rx of padroes) {
    for (const m of bruto.matchAll(rx)) {
      const nome = (m[1] || '').replace(/\s+/g, ' ').trim();
      if (nomeValido(nome)) nomes.add(nome);
    }
  }

  return [...nomes];
}

function extrairNomesApuracao(apurados, contextoExtra = '') {
  const textos = [
    contextoExtra,
    ...apurados.map((a) => [
      a.titulo,
      a.resumo,
      a.contextoApuracao,
      ...(a.fontesApuracao || []).map((f) => `${f.titulo || ''} ${f.trecho || ''} ${f.resumo || ''}`)
    ].join('\n'))
  ].join('\n');

  return extrairNomesDoTexto(textos);
}

function montarConsultasInvestigativa(palavrasChave, formato) {
  const chave = palavrasChave.trim();
  const consultas = [
    chave,
    `${chave} gospel brasil`,
    `"${chave}" pastor evangélico`
  ];

  if (formato === 'listagem_nomes' || pautaMencionaDivorcio(chave)) {
    consultas.push(
      'pastores evangélicos brasileiros divorciados nomes lista',
      'pastores gospel famosos que se divorciaram',
      'pastor evangélico divórcio casamento brasil notícia',
      'lista pastores divorciados igreja evangélica brasil',
      'site:guiame.com.br pastor divorciado',
      'site:gospelprime.com.br pastor divórcio',
      'site:portaldogospel.com.br pastor separação'
    );
  }

  return [...new Set(consultas)].slice(0, 10);
}

function montarContextoInvestigativo(palavrasChave, apurados, { formato, nomesApurados, contextoFactual }) {
  const linhas = [
    `TEMA OBRIGATÓRIO: ${palavrasChave}`,
    `FORMATO: ${formato === 'listagem_nomes' ? 'LISTAGEM — informar QUEM SÃO (nomes completos confirmados nas fontes)' : 'reportagem investigativa'}`,
    ''
  ];

  if (formato === 'listagem_nomes') {
    linhas.push(
      'REGRA CRÍTICA: Cite SOMENTE pessoas cujos nomes aparecem abaixo em FONTES APURADAS.',
      'Se um nome NÃO estiver listado, NÃO invente, NÃO especule, NÃO use perfis genéricos de redes como substituto.',
      nomesApurados.length
        ? `NOMES CONFIRMADOS NAS FONTES (${nomesApurados.length}): ${nomesApurados.join('; ')}`
        : 'NOMES CONFIRMADOS: nenhum identificado com segurança — explique isso ao leitor; NÃO invente nomes.',
      ''
    );
  }

  if (contextoFactual) {
    linhas.push('=== CONTEXTO FACTUAL (Brave/apuração web) ===');
    linhas.push(contextoFactual.slice(0, 3500));
    linhas.push('');
  }

  linhas.push(`Fontes individuais apuradas (${apurados.length}):`);

  apurados.forEach((fonte, i) => {
    const veiculo = fonte.redeSocial || fonte.veiculo || fonte.fonte || 'Web';
    linhas.push(`\n=== Fonte ${i + 1}: ${fonte.titulo || 'Sem título'} (${veiculo}) ===`);
    if (fonte.resumo) linhas.push(`Resumo: ${fonte.resumo}`);
    if (fonte.contextoApuracao) {
      linhas.push(fonte.contextoApuracao.slice(0, 2500));
    } else if (fonte.fontesApuracao?.length) {
      fonte.fontesApuracao.forEach((f) => {
        if (f.trecho) linhas.push(`Trecho: ${f.trecho.slice(0, 1000)}`);
        if (f.resumo) linhas.push(`Detalhe: ${f.resumo.slice(0, 500)}`);
      });
    }
    if (fonte.link) linhas.push(`URL: ${fonte.link}`);
  });

  return linhas.join('\n').slice(0, 16000);
}

function montarTituloPauta(palavrasChave) {
  return `Apuração: ${palavrasChave.slice(0, 120)}`;
}

async function buscarFontesInvestigativa(palavrasChave, opcoes = {}) {
  const {
    diasRecentes = '7',
    conteudoInternacional = true,
    incluirRedesSociais = true,
    formato = 'reportagem'
  } = opcoes;

  const diasBusca = diasRecentes === 'tudo' ? 365 : (parseInt(diasRecentes, 10) || (diasRecentes === '24h' ? 1 : 7));
  const freshBrave = diasBusca >= 30 ? 'py' : diasBusca >= 7 ? 'pm' : 'pw';
  const periodo = diasRecentes === 'tudo' ? { dias: 365 } : diasRecentes;
  const consultas = montarConsultasInvestigativa(palavrasChave, formato);

  const buscasConsulta = consultas.flatMap((q) => [
    buscarBraveWeb(q, palavrasChave, 8, { freshness: freshBrave, fonteLabel: 'Web apuração' }).catch(() => []),
    buscarGoogleNews(q, 6, { dias: Math.min(diasBusca, 30) }).catch(() => [])
  ]);

  const [topicosNichos, brave, google, web, portais, redes, ...extrasConsultas] = await Promise.all([
    pesquisarNichos(palavrasChave, 8, {
      incluirRedesSociais: formato === 'listagem_nomes' ? false : incluirRedesSociais,
      somenteRedesSociais: false,
      somenteRecentes: diasRecentes !== 'tudo' && diasRecentes !== '365',
      diasRecentes: diasRecentes === 'tudo' ? '365' : diasRecentes,
      conteudoInternacional: formato === 'listagem_nomes' ? false : conteudoInternacional,
      incluirGoogleTrends: false,
      buscaAmpliada: true
    }),
    buscarBraveNews(palavrasChave, 12, Math.min(diasBusca, 30)).catch(() => []),
    buscarGoogleNews(palavrasChave, 10, { dias: Math.min(diasBusca, 30) }).catch(() => []),
    buscarWebGospel(palavrasChave, 10, Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
    buscarPortaisGospel(palavrasChave, 12, Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
    formato === 'listagem_nomes'
      ? Promise.resolve([])
      : (incluirRedesSociais
        ? buscarRedesSociais(palavrasChave, 8, periodo, { modoAmpliado: false, conteudoInternacional }).catch(() => [])
        : Promise.resolve([])),
    ...buscasConsulta
  ]);

  const brutos = [
    ...topicosNichos,
    ...brave,
    ...google,
    ...web,
    ...portais,
    ...redes,
    ...extrasConsultas.flat()
  ];

  const unicos = [];
  for (const item of brutos) {
    if (!item?.titulo) continue;
    if (unicos.some((u) => titulosSimilares(u.titulo, item.titulo))) continue;
    unicos.push(item);
  }

  const relevantes = unicos
    .filter((item) => itemRelevanteParaPauta(item, palavrasChave, formato))
    .sort((a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave, formato) - pontuarRelevanciaInvestigativa(a, palavrasChave, formato));

  let selecionados = relevantes.slice(0, MAX_FONTES_APURAR);

  if (selecionados.length < MIN_FONTES_IDEAIS) {
    const fallback = unicos
      .filter((item) => !itemPareceInternacionalIrrelevante(item, palavrasChave))
      .filter((item) => contarTermosNoItem(item, extrairTermosInvestigativa(palavrasChave)) >= 1)
      .sort((a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave, formato) - pontuarRelevanciaInvestigativa(a, palavrasChave, formato));
    for (const item of fallback) {
      if (selecionados.length >= MAX_FONTES_APURAR) break;
      if (selecionados.some((s) => titulosSimilares(s.titulo, item.titulo))) continue;
      selecionados.push(item);
    }
  }

  if (!selecionados.length) {
    throw new Error(
      `Nenhuma fonte encontrada sobre "${palavrasChave}". Tente incluir nomes específicos ou ampliar o período.`
    );
  }

  return selecionados;
}

async function buscarContextoFactual(palavrasChave, formato) {
  if (!braveDisponivel()) return null;
  const query = formato === 'listagem_nomes'
    ? `Liste pastores evangélicos brasileiros que se divorciaram, com nomes completos e contexto verificável. Tema: ${palavrasChave}. Apenas fatos de fontes confiáveis.`
    : `Fatos verificáveis sobre: ${palavrasChave}. Contexto gospel/evangélico brasileiro.`;
  try {
    return await buscarContextoLlm(query, { maxTokens: 3200 });
  } catch {
    return null;
  }
}

async function apurarPautaInvestigativa(palavrasChave, opcoes = {}) {
  const chave = normalizarPalavrasChave(palavrasChave);
  const formato = detectarFormatoInvestigativa(chave);

  const [fontesBrutas, contextoFactual] = await Promise.all([
    buscarFontesInvestigativa(chave, { ...opcoes, formato }),
    buscarContextoFactual(chave, formato)
  ]);

  const apurados = await Promise.all(fontesBrutas.map((item) => apurarTopico(item)));
  const todasFontes = deduplicarFontesApuracao(apurados.flatMap((a) => a.fontesApuracao || []));
  const nomesApurados = extrairNomesApuracao(apurados, contextoFactual || '');

  if (formato === 'listagem_nomes' && nomesApurados.length < 2) {
    throw new Error(
      `A apuração encontrou ${apurados.length} fonte(s), mas não identificou nomes de pastores divorciados com segurança. ` +
      'Tente palavras-chave com nomes específicos (ex.: "pastor Fulano divórcio") ou busque em portais que publiquem listas. ' +
      'A IA não vai inventar nomes.'
    );
  }

  const contextoApuracao = montarContextoInvestigativo(chave, apurados, {
    formato,
    nomesApurados,
    contextoFactual
  });

  return {
    palavrasChave: chave,
    formatoInvestigativa: formato,
    nomesApurados,
    titulo: montarTituloPauta(chave),
    resumo: formato === 'listagem_nomes'
      ? `Listagem apurada: ${nomesApurados.length} nome(s) confirmado(s) em ${apurados.length} fontes sobre "${chave}".`
      : `Matéria investigativa sobre "${chave}" com ${apurados.length} fontes apuradas.`,
    link: apurados.find((a) => a.link)?.link || null,
    nicho: chave.split(/[,;]+/)[0]?.trim() || chave,
    contextoApuracao,
    fontesApuracao: todasFontes,
    fontesResumo: apurados.map((a) => ({
      titulo: a.titulo,
      veiculo: a.redeSocial || a.veiculo || a.fonte || 'Web',
      url: a.link,
      redeSocial: !!a.redeSocial
    })),
    redeSocial: false,
    fonteInternacional: false,
    contagemFontes: apurados.length
  };
}

function artigoCitaNomesApurados(artigo, nomesApurados) {
  if (!nomesApurados?.length) return true;
  const texto = `${artigo.titulo || ''} ${artigo.conteudo || ''} ${artigo.resumo || ''}`;
  const citados = nomesApurados.filter((nome) => {
    const sobrenome = nome.split(/\s+/).pop();
    return texto.includes(nome) || (sobrenome && sobrenome.length > 3 && texto.includes(sobrenome));
  });
  return citados.length >= Math.min(2, nomesApurados.length);
}

module.exports = {
  apurarPautaInvestigativa,
  buscarFontesInvestigativa,
  normalizarPalavrasChave,
  detectarFormatoInvestigativa,
  extrairNomesApuracao,
  artigoCitaNomesApurados
};
