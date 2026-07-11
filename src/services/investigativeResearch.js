const {
  pesquisarNichos,
  apurarTopico,
  buscarBraveNews,
  buscarGoogleNews,
  buscarGoogleNewsHistorico,
  buscarWebGospel,
  buscarRedesSociais,
  buscarPortaisGospel,
  buscarBraveWeb
} = require('./newsResearch');
const { buscarContextoLlm, buscarWeb } = require('./braveSearch');
const { extrairCorpoArtigo } = require('./articleSource');
const { braveDisponivel } = require('./braveApi');
const { titulosSimilares } = require('../utils/topicMatch');
const {
  obterEvidenciasVerificadas,
  montarBlocoEvidencias,
  artigoRespeitaEvidencias,
  consolidarEvidencias
} = require('./evidenceVerification');

const MAX_FONTES_APURAR = 55;
const MAX_APURACAO_PROFUNDA = 45;
const MIN_FONTES_IDEAIS = 8;
const MIN_NOMES_LISTAGEM = 2;

const QUERIES_LISTAGEM = [
  'site:fuxicogospel.com.br divorciaram',
  'site:fuxicogospel.com.br separação gospel',
  'famosos gospel divorciaram lista',
  '5 famosos gospel divorciaram',
  'lista pastores evangélicos divorciados',
  'pastores gospel divorciados veja quem',
  'pastores que divorciaram e voce não sabia',
  'pastores evangélicos divorciados nomes lista',
  'cantores e pastores gospel divorciaram brasil',
  'site:gospelprime.com.br pastor divorciou lista',
  'site:guiame.com.br pastor separação lista'
];

const PORTAIS_APURACAO = [
  'fuxicogospel.com.br', 'guiame.com.br', 'gospelprime.com.br', 'portaldogospel.com.br', 'folhagospel.com',
  'panorama.com.br', 'pleno.news', 'agenciaelos.com.br', 'supergospelsp.com.br',
  'verdadegospel.com.br', 'gospelcenter.com.br', 'adoradores.com.br', 'g1.globo.com'
];

const STOP_TERMOS_INVEST = new Set([
  'gospel', 'evangelico', 'igreja', 'brasil', 'noticia', 'noticias', 'portal',
  'vc', 'voce', 'você', 'nao', 'não', 'sabia', 'que', 'com', 'para', 'uma',
  'the', 'and', 'sobre', 'mais', 'como', 'seu', 'sua', 'dos', 'das', 'nos',
  'eles', 'elas', 'quem', 'sao', 'são', 'ja', 'já', 'evangélicos', 'evangelicos'
]);

const NOMES_FALSO_POSITIVO = new Set([
  'mateus', 'timoteo', 'timóteo', 'eclesiastes', 'deus', 'cristo', 'espirito',
  'santo', 'senhor', 'biblia', 'bíblia', 'igreja', 'brasil', 'gospel', 'louvor',
  'youtube', 'instagram', 'threads', 'tiktok', 'facebook', 'google', 'primeira',
  'carta', 'portanto', 'conforme', 'segundo', 'relatos', 'redes', 'sociais',
  'evangelica', 'evangélica', 'universal', 'deus', 'amor', 'vida', 'familia',
  'família', 'casamento', 'ministerio', 'ministério', 'reino', 'céus', 'ceus'
]);

function normalizarTextoBusca(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function semFiltroPeriodo(diasRecentes) {
  return diasRecentes === 'tudo' || diasRecentes === 'all' || !diasRecentes;
}

function extrairTermosInvestigativa(palavrasChave) {
  return normalizarTextoBusca(palavrasChave)
    .split(/[\s,;\n+/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_TERMOS_INVEST.has(t));
}

function textoItemInvestigativa(item) {
  return `${item.titulo || ''} ${item.resumo || ''} ${item.conteudoRede || ''} ${item.corpoProfundo || ''} ${item.nicho || ''}`;
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
  return termos.filter((t) => termoApareceNoTexto(textoItemInvestigativa(item), t)).length;
}

function detectarFormatoInvestigativa(palavrasChave) {
  const t = normalizarTextoBusca(palavrasChave);
  if (/quem\s+(sao|são)|que\s+sao\s+eles|veja\s+qu[ae]\s+sao|lista\s+(?:de\s+)?|nomes\s+dos|nomes\s+de|quais\s+(sao|são)|nao\s+sabia|não\s+sabia|voce\s+nao\s+sabia|você\s+não\s+sabia/.test(t)) {
    return 'listagem_nomes';
  }
  if (/pastor|pastora|bispo|pregador/.test(t) && /divorci|separou|separacao|separação/.test(t)) {
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
  return /divorci|divorcio|separou|separacao|separação|dissolucao|dissolução|rompeu.*casamento|fim\s+do\s+casamento|termino\s+do\s+casamento|anunciou\s+separacao/.test(
    normalizarTextoBusca(textoItemInvestigativa(item))
  );
}

function itemPareceInternacionalIrrelevante(item, palavrasChave) {
  const link = (item.link || '').toLowerCase();
  const texto = normalizarTextoBusca(textoItemInvestigativa(item));
  if (/venezuela|mexico|argentina|colombia|españa|spain|philippines|filipinas/.test(link + texto)) {
    if (!/brasil|brasileir/.test(texto)) return true;
  }
  return false;
}

function itemRelevanteParaPauta(item, palavrasChave, formato, { relaxado = false } = {}) {
  if (itemPareceInternacionalIrrelevante(item, palavrasChave)) return false;

  const termos = extrairTermosInvestigativa(palavrasChave);
  const hits = contarTermosNoItem(item, termos);
  const minHits = relaxado ? 1 : (termos.length <= 2 ? 1 : Math.max(2, Math.ceil(termos.length * 0.25)));

  if (formato === 'listagem_nomes' || pautaMencionaDivorcio(palavrasChave)) {
    const texto = normalizarTextoBusca(textoItemInvestigativa(item));
    const temPastor = /pastor|pastora|bispo|pregador|ministro\s+evangel|lider\s+religios/.test(texto);
    const temLista = /lista|quem\s+sao|nao\s+sabia|nomes|famoss|voce\s+nao/.test(texto);
    if (temPastor && (itemMencionaDivorcio(item) || temLista)) return true;
    if (relaxado && temPastor && hits >= 1) return true;
    if (hits >= minHits && itemMencionaDivorcio(item)) return true;
    return relaxado && hits >= 1 && /divorci|separou|casamento/.test(texto);
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
  }).slice(0, 50);
}

function pontuarRelevanciaInvestigativa(item, palavrasChave, formato) {
  const texto = normalizarTextoBusca(textoItemInvestigativa(item));
  let score = contarTermosNoItem(item, extrairTermosInvestigativa(palavrasChave)) * 3;

  if (formato === 'listagem_nomes' || pautaMencionaDivorcio(palavrasChave)) {
    if (ehFonteListagem(item)) score += 18;
    if (/pastor|pastora/.test(texto) && itemMencionaDivorcio(item)) score += 12;
    if (/lista|quem\s+sao|nao\s+sabia|nomes|famoss/.test(texto)) score += 8;
    if (item.tipoFonte === 'portal_gospel' || item.tipoFonte === 'noticia') score += 6;
    if ((item.corpoProfundo || '').length > 500) score += 5;
  }

  if (itemPareceInternacionalIrrelevante(item, palavrasChave)) score -= 30;
  if (item.tipoFonte === 'portal_gospel') score += 3;
  if ((item.resumo || '').length > 120) score += 2;

  return score;
}

function capitalizarNome(nome) {
  return String(nome || '')
    .trim()
    .split(/\s+/)
    .map((p) => (p.length <= 2 && /^(de|da|do|dos|das|e)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join(' ');
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
    /pastor(?:a)?\s+([a-zà-ú]{3,}(?:\s+(?:de|da|do|dos|das)\s+[a-zà-ú]{3,})?(?:\s+[a-zà-ú]{3,})?)/gi,
    /(?:^|[\n.!?;•])\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)\s+(?:se\s+)?divorciou/gi,
    /\d+[\.)]\s*(?:Pastor(?:a)?\s+)?([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][^\n,;]{4,55})/g,
    /(?:^|[\n•\-–])\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)\s*[–—:\-]/g,
    /(?:bispo|pregador|cantor\s+gospel)\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)/gi
  ];

  for (const rx of padroes) {
    for (const m of bruto.matchAll(rx)) {
      let nome = (m[1] || '').replace(/\s+/g, ' ').trim();
      nome = nome.replace(/\s*(divorciou|se separou|anunciou).*$/i, '').trim();
      nome = capitalizarNome(nome);
      if (nomeValido(nome)) nomes.add(nome);
    }
  }

  const janelasDivorcio = bruto.split(/divorci|separou|separação|separacao|dissolução|dissolucao|fim do casamento/gi);
  for (const janela of janelasDivorcio) {
    const trecho = janela.slice(0, 180);
    for (const m of trecho.matchAll(/([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)/g)) {
      const nome = capitalizarNome(m[1]);
      if (nomeValido(nome)) nomes.add(nome);
    }
  }

  return [...nomes];
}

function extrairNomesApuracao(apurados, contextoExtra = '') {
  const textos = [
    contextoExtra,
    ...apurados.flatMap((a) => [
      a.titulo,
      a.resumo,
      a.corpoProfundo,
      a.contextoApuracao,
      ...(a.fontesApuracao || []).map((f) => `${f.titulo || ''} ${f.trecho || ''} ${f.resumo || ''}`)
    ])
  ].filter(Boolean).join('\n');

  return extrairNomesDoTexto(textos);
}

function montarConsultasInvestigativa(palavrasChave, formato) {
  const chave = palavrasChave.trim();
  const consultas = [
    chave,
    `${chave} brasil`,
    `"${chave}"`,
    `${chave} gospel`
  ];

  if (formato === 'listagem_nomes' || pautaMencionaDivorcio(chave)) {
    consultas.push(
      'pastor evangelico divorciou brasil',
      'pastora divorciou gospel brasil',
      'pastor anunciou divórcio',
      'pastor anunciou separação conjugal',
      'pastores evangélicos divorciados nomes',
      'pastores gospel famosos que se divorciaram',
      'pastor evangélico divórcio casamento brasil',
      'lista pastores divorciados igreja evangélica',
      'pastores que divorciaram e você não sabia',
      'bispo evangélico divorciou brasil',
      'pregador divorciou esposa igreja brasil',
      'pastor separação conjugal evangélico',
      '"divorciou" pastor gospel brasil',
      '"anunciou o divórcio" pastor',
      'Lanna Holder divorcio Ronaldo',
      'Alan Pereira divorcio lagoinha',
      'pastor evangélico término casamento',
      'pastores renomados divorciados brasil',
      'famosos gospel divorciaram lista',
      'site:fuxicogospel.com.br divorciaram',
      'site:fuxicogospel.com.br separação pastor',
      'Vanilda Bordieri divorcio',
      'David Lacerda separação',
      'Alexandre Mendes divorcio pastor'
    );
    for (const site of PORTAIS_APURACAO) {
      consultas.push(`site:${site} pastor divorciou`);
      consultas.push(`site:${site} divórcio pastor`);
    }
  }

  return [...new Set(consultas)];
}

function opcoesBraveWeb(diasRecentes) {
  if (semFiltroPeriodo(diasRecentes)) {
    return { freshness: null, limite: 20 };
  }
  const dias = parseInt(diasRecentes, 10) || (diasRecentes === '24h' ? 1 : 7);
  if (dias >= 365) return { freshness: null, limite: 15 };
  if (dias >= 30) return { freshness: 'py', limite: 12 };
  if (dias >= 7) return { freshness: 'pm', limite: 12 };
  return { freshness: 'pw', limite: 10 };
}

async function executarBuscaBraveWeb(query, palavrasChave, diasRecentes) {
  const { freshness, limite } = opcoesBraveWeb(diasRecentes);
  const opts = { fonteLabel: 'Web apuração' };
  if (freshness) opts.freshness = freshness;
  return buscarBraveWeb(query, palavrasChave, limite, opts).catch(() => []);
}

async function executarBuscaWebBrave(query, semFiltro) {
  if (!braveDisponivel()) return [];
  const resultados = await buscarWeb(query, {
    count: 20,
    freshness: semFiltro ? undefined : 'py'
  }).catch(() => []);
  return resultados.map((r) => ({
    titulo: r.titulo,
    link: r.link,
    resumo: r.resumo,
    nicho: query,
    fonte: r.fonte || 'Web',
    tipoFonte: 'web',
    recente: false
  }));
}

function ehFonteListagem(item) {
  const t = normalizarTextoBusca(`${item.titulo || ''} ${item.link || ''} ${item.resumo || ''}`);
  return /famosos.*divorci|divorci.*famosos|lista.*pastor|pastor.*lista|pastores.*divorci|divorci.*pastor|\d+\s+famosos|numero\s+cinco|n[oó]mero\s+cinco|nomes.*divorci|quem.*divorci|voce\s+nao\s+sabia|você\s+não\s+sabia|se\s+divorciaram|fuxicogospel.*divorci|casamento\s+acabou.*gospel|escondeu\s+ate\s+hoje/i.test(t);
}

function pontuarFonteListagem(item) {
  let score = pontuarRelevanciaInvestigativa(item, 'pastores divorciados lista', 'listagem_nomes');
  if (ehFonteListagem(item)) score += 25;
  if (/fuxicogospel|famosos.*divorci|\d+\s+famosos/i.test(`${item.titulo || ''} ${item.link || ''}`)) score += 20;
  if (/lista|quem\s+sao|nao\s+sabia|você\s+não\s+sabia/i.test(item.titulo || '')) score += 12;
  return score;
}

async function buscarFontesListagem(palavrasChave, opcoes = {}) {
  const { diasRecentes = '7' } = opcoes;
  const semFiltro = semFiltroPeriodo(diasRecentes);
  const diasBusca = semFiltro ? 3650 : (parseInt(diasRecentes, 10) || 30);
  const consultas = [...new Set([...QUERIES_LISTAGEM, `${palavrasChave.trim()} lista`, `${palavrasChave.trim()} nomes`])];

  const buscas = consultas.flatMap((q) => [
    executarBuscaBraveWeb(q, palavrasChave, diasRecentes),
    semFiltro
      ? buscarGoogleNewsHistorico(q, 22).catch(() => [])
      : buscarGoogleNews(q, 12, { dias: Math.min(diasBusca, 30) }).catch(() => []),
    executarBuscaWebBrave(q, semFiltro)
  ]);

  const brutos = mesclarResultados((await Promise.all(buscas)).flat());
  const listagens = brutos.filter(ehFonteListagem);

  return (listagens.length ? listagens : brutos.filter((item) => itemMencionaDivorcio(item)))
    .sort((a, b) => pontuarFonteListagem(b) - pontuarFonteListagem(a))
    .slice(0, 25);
}

function mesclarApurados(apurados, novos) {
  const links = new Set(apurados.map((a) => a.link).filter(Boolean));
  const titulos = apurados.map((a) => a.titulo).filter(Boolean);
  const saida = [...apurados];
  for (const item of novos) {
    if (item.link && links.has(item.link)) continue;
    if (item.titulo && titulos.some((t) => titulosSimilares(t, item.titulo))) continue;
    if (item.link) links.add(item.link);
    saida.push(item);
  }
  return saida;
}

function contarEvidenciasListagem(evidencias) {
  return (evidencias || []).filter((e) => e.origem === 'listagem').length;
}

function mesclarResultados(brutos) {
  const unicos = [];
  for (const item of brutos) {
    if (!item?.titulo) continue;
    if (unicos.some((u) => titulosSimilares(u.titulo, item.titulo))) continue;
    if (item.link && unicos.some((u) => u.link === item.link)) continue;
    unicos.push(item);
  }
  return unicos;
}

async function buscarFontesInvestigativa(palavrasChave, opcoes = {}) {
  const {
    diasRecentes = '7',
    conteudoInternacional = true,
    incluirRedesSociais = true,
    formato = 'reportagem',
    onda = 1
  } = opcoes;

  const semFiltro = semFiltroPeriodo(diasRecentes);
  const diasBusca = semFiltro ? 3650 : (parseInt(diasRecentes, 10) || (diasRecentes === '24h' ? 1 : 7));
  const consultas = onda === 2
    ? [
      'pastor evangelico divorciou brasil nome',
      'pastora gospel anunciou divorcio',
      'pastores famosos separação casamento brasil',
      'historia pastores divorciados igreja',
      'cantor gospel divorciou pastor',
      'bispo divorciou brasil noticia'
    ]
    : onda === 3
      ? [
        'site:fuxicogospel.com.br divorciaram',
        'famosos gospel divorciaram lista',
        'Lanna Holder divorcio',
        'Ronaldo Holder divorcio',
        'Alan Pereira divorcio pastor',
        'Vanilda Bordieri divorcio',
        'David Lacerda separação',
        'pastor lagoinha divorciou',
        'pastor universal divorciou',
        'pastor batista divorciou brasil'
      ]
      : montarConsultasInvestigativa(palavrasChave, formato);

  const buscasConsulta = consultas.flatMap((q) => [
    executarBuscaBraveWeb(q, palavrasChave, diasRecentes),
    semFiltro
      ? buscarGoogleNewsHistorico(q, 18).catch(() => [])
      : buscarGoogleNews(q, 10, { dias: Math.min(diasBusca, 30) }).catch(() => []),
    executarBuscaWebBrave(q, semFiltro)
  ]);

  const lotesBase = onda === 1
    ? await Promise.all([
      pesquisarNichos(palavrasChave, 12, {
        incluirRedesSociais: false,
        somenteRedesSociais: false,
        somenteRecentes: !semFiltro,
        diasRecentes: semFiltro ? '365' : diasRecentes,
        conteudoInternacional: false,
        incluirGoogleTrends: false,
        buscaAmpliada: true
      }),
      buscarBraveNews('pastor divorciou gospel brasil', 20, semFiltro ? 365 : Math.min(diasBusca, 30)).catch(() => []),
      buscarBraveNews(palavrasChave, 20, semFiltro ? 365 : Math.min(diasBusca, 30)).catch(() => []),
      semFiltro
        ? buscarGoogleNewsHistorico('pastor divorciou gospel brasil', 25)
        : buscarGoogleNews(palavrasChave, 15, { dias: Math.min(diasBusca, 30) }).catch(() => []),
      semFiltro ? buscarGoogleNewsHistorico(palavrasChave, 25) : Promise.resolve([]),
      buscarWebGospel('pastor divorciou gospel', 20, semFiltro ? 365 : Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
      buscarPortaisGospel('pastor divorciou divórcio', 25, semFiltro ? 365 : Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
      ...buscasConsulta
    ])
    : await Promise.all(buscasConsulta);

  const brutos = mesclarResultados(lotesBase.flat(2));

  const relaxado = semFiltro || onda >= 2;
  const relevantes = brutos
    .filter((item) => itemRelevanteParaPauta(item, palavrasChave, formato, { relaxado }))
    .sort((a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave, formato) - pontuarRelevanciaInvestigativa(a, palavrasChave, formato));

  let selecionados = relevantes.slice(0, MAX_FONTES_APURAR);

  if (selecionados.length < MIN_FONTES_IDEAIS) {
    const fallback = brutos
      .filter((item) => !itemPareceInternacionalIrrelevante(item, palavrasChave))
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

async function apuracaoProfunda(apurados) {
  const comLink = apurados
    .filter((a) => a.link && !a.redeSocial)
    .sort((a, b) => {
      const la = ehFonteListagem(a) ? 2 : 0;
      const lb = ehFonteListagem(b) ? 2 : 0;
      if (lb !== la) return lb - la;
      const ta = `${a.titulo || ''} ${a.resumo || ''}`;
      const tb = `${b.titulo || ''} ${b.resumo || ''}`;
      const pa = /divorci|divórcio|separou|separa/i.test(ta) ? 1 : 0;
      const pb = /divorci|divórcio|separou|separa/i.test(tb) ? 1 : 0;
      return pb - pa;
    })
    .slice(0, MAX_APURACAO_PROFUNDA);

  const lote = 5;

  for (let i = 0; i < comLink.length; i += lote) {
    const fatia = comLink.slice(i, i + lote);
    await Promise.all(fatia.map(async (item) => {
      try {
        const { corpo, titulo, descricao } = await extrairCorpoArtigo(item.link);
        const texto = corpo || descricao || '';
        if (texto) item.corpoProfundo = texto.slice(0, 16000);
        if (titulo) item.titulo = item.titulo || titulo;
      } catch (e) {
        console.warn('apuracaoProfunda:', item.link, e.message);
      }
    }));
  }

  return apurados;
}

async function buscarContextoFactual(palavrasChave, formato) {
  if (!braveDisponivel()) return '';

  const consultas = formato === 'listagem_nomes'
    ? [
      `Liste pastores evangélicos brasileiros que se divorciaram, com nomes completos e contexto. Tema: ${palavrasChave}. Somente fatos verificáveis de matérias e portais.`,
      `Quais pastores gospel do Brasil passaram por divórcio ou separação conjugal? Nomes completos e igrejas/denominações quando disponível.`,
      `Histórico de pastores evangélicos brasileiros divorciados: ${palavrasChave}`
    ]
    : [`Fatos verificáveis sobre: ${palavrasChave}. Contexto gospel brasileiro.`];

  const partes = await Promise.all(
    consultas.map((q) => buscarContextoLlm(q, { maxTokens: 4000 }).catch(() => null))
  );

  return partes.filter(Boolean).join('\n\n---\n\n').slice(0, 12000);
}

function montarContextoInvestigativo(palavrasChave, apurados, { formato, evidenciasVerificadas }) {
  const linhas = [
    `TEMA OBRIGATÓRIO: ${palavrasChave}`,
    `FORMATO: ${formato === 'listagem_nomes' ? 'LISTAGEM com prova documental por pessoa' : 'reportagem investigativa'}`,
    ''
  ];

  if (formato === 'listagem_nomes') {
    linhas.push(montarBlocoEvidencias(evidenciasVerificadas || []));
    linhas.push('');
  }

  linhas.push(`Matérias lidas na apuração (${apurados.length}) — contexto de apoio (não use fatos daqui se não estiverem nas evidências):`);

  apurados.forEach((fonte, i) => {
    const veiculo = fonte.redeSocial || fonte.veiculo || fonte.fonte || 'Web';
    linhas.push(`\n=== Fonte ${i + 1}: ${fonte.titulo || 'Sem título'} (${veiculo}) ===`);
    if (fonte.resumo) linhas.push(`Resumo: ${fonte.resumo}`);
    if (fonte.corpoProfundo) {
      linhas.push(`Conteúdo lido (${fonte.corpoProfundo.length} chars):\n${fonte.corpoProfundo.slice(0, 4000)}`);
    } else if (fonte.contextoApuracao) {
      linhas.push(fonte.contextoApuracao.slice(0, 2500));
    }
    if (fonte.link) linhas.push(`URL: ${fonte.link}`);
  });

  return linhas.join('\n').slice(0, 22000);
}

function montarTituloPauta(palavrasChave) {
  return `Apuração: ${palavrasChave.slice(0, 120)}`;
}

async function apurarPautaInvestigativa(palavrasChave, opcoes = {}) {
  const chave = normalizarPalavrasChave(palavrasChave);
  const formato = detectarFormatoInvestigativa(chave);

  let apurados = [];
  let evidenciasVerificadas = [];

  async function processarFontes(fontes) {
    if (!fontes.length) return;
    const novos = await Promise.all(fontes.map((item) => apurarTopico(item)));
    const profundos = await apuracaoProfunda(novos);
    apurados = mesclarApurados(apurados, profundos);
    if (formato === 'listagem_nomes') {
      evidenciasVerificadas = await obterEvidenciasVerificadas(apurados, chave, { formato });
    }
  }

  const precisaMaisNomes = () => formato !== 'listagem_nomes'
    || evidenciasVerificadas.length < MIN_NOMES_LISTAGEM
    || contarEvidenciasListagem(evidenciasVerificadas) < MIN_NOMES_LISTAGEM;

  if (formato === 'listagem_nomes') {
    await processarFontes(await buscarFontesListagem(chave, opcoes));
  }

  if (precisaMaisNomes()) {
    await processarFontes(await buscarFontesInvestigativa(chave, { ...opcoes, formato, onda: 1 }));
  }

  if (precisaMaisNomes()) {
    const fontesOnda2 = await buscarFontesInvestigativa(chave, { ...opcoes, formato, onda: 2 });
    await processarFontes(fontesOnda2);
  }

  if (precisaMaisNomes()) {
    await processarFontes(await buscarFontesListagem(chave, opcoes));
  }

  if (precisaMaisNomes()) {
    const fontesOnda3 = await buscarFontesInvestigativa(chave, { ...opcoes, formato, onda: 3 });
    await processarFontes(fontesOnda3);
  }

  const evidenciasConsolidadas = consolidarEvidencias(evidenciasVerificadas);
  const nomesApurados = evidenciasConsolidadas.map((e) => e.nome);

  if (formato === 'listagem_nomes' && evidenciasConsolidadas.length < MIN_NOMES_LISTAGEM) {
    throw new Error(
      `Apuração: ${apurados.length} matérias analisadas, mas só ${evidenciasConsolidadas.length} nome(s) com divórcio documentado (mínimo ${MIN_NOMES_LISTAGEM} para lista). ` +
      'Tente palavras-chave como "famosos gospel divorciaram fuxico" ou apague o rascunho antigo só com Cláudio Duarte e gere de novo.'
    );
  }

  const todasFontes = deduplicarFontesApuracao(apurados.flatMap((a) => a.fontesApuracao || []));
  const contextoApuracao = montarContextoInvestigativo(chave, apurados, {
    formato,
    evidenciasVerificadas: evidenciasConsolidadas
  });

  return {
    palavrasChave: chave,
    formatoInvestigativa: formato,
    nomesApurados,
    evidenciasVerificadas: evidenciasConsolidadas,
    titulo: montarTituloPauta(chave),
    resumo: formato === 'listagem_nomes'
      ? `${evidenciasConsolidadas.length} caso(s) com divórcio documentado em ${apurados.length} matérias lidas.`
      : `Matéria investigativa: ${apurados.length} fontes com leitura profunda.`,
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
  return citados.length >= Math.min(1, nomesApurados.length);
}

module.exports = {
  apurarPautaInvestigativa,
  buscarFontesInvestigativa,
  buscarFontesListagem,
  normalizarPalavrasChave,
  detectarFormatoInvestigativa,
  artigoCitaNomesApurados,
  artigoRespeitaEvidencias
};
