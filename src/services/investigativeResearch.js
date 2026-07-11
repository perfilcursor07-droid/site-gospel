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

const MAX_FONTES_APURAR = 20;
const MAX_APURACAO_PROFUNDA = 16;
const MIN_FONTES_IDEAIS = 4;
const MIN_NOMES_LISTAGEM = 1;

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
  if (/quem\s+(sao|são)|que\s+sao\s+eles|lista\s+de|nomes\s+dos|nomes\s+de|quais\s+(sao|são)|nao\s+sabia|não\s+sabia|voce\s+nao\s+sabia/.test(t)) {
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
  }).slice(0, 25);
}

function pontuarRelevanciaInvestigativa(item, palavrasChave, formato) {
  const texto = normalizarTextoBusca(textoItemInvestigativa(item));
  let score = contarTermosNoItem(item, extrairTermosInvestigativa(palavrasChave)) * 3;

  if (formato === 'listagem_nomes' || pautaMencionaDivorcio(palavrasChave)) {
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
      'pastores evangélicos brasileiros divorciados nomes',
      'pastores gospel famosos que se divorciaram lista',
      'pastor evangélico divórcio casamento brasil',
      'lista pastores divorciados igreja evangélica',
      'pastores que divorciaram e você não sabia',
      'pastores divorciados gospel brasil história',
      'bispo evangélico divorciado brasil',
      'pregador divorciou esposa igreja brasil',
      'pastor separação conjugal evangélico brasil',
      'site:guiame.com.br pastor divorciado',
      'site:gospelprime.com.br pastor divórcio',
      'site:portaldogospel.com.br pastor separação',
      'site:pleno.news pastor divorciado',
      'site:folhagospel.com divorcio pastor',
      'site:panorama.com.br pastor separou',
      'site:supergospelsp.com.br pastor casamento',
      'site:agenciaelos.com.br pastor',
      'pastor evangélico anunciou divórcio',
      'pastores renomados divorciados brasil'
    );
  }

  return [...new Set(consultas)];
}

function opcoesBraveWeb(diasRecentes) {
  if (semFiltroPeriodo(diasRecentes)) {
    return { freshness: null, limite: 15 };
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

async function executarBuscaWebBrave(query) {
  if (!braveDisponivel()) return [];
  const fresh = 'py';
  const resultados = await buscarWeb(query, { count: 15, freshness: fresh }).catch(() => []);
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
      'pastor evangelico divorciou brasil nome completo',
      'pastores famosos gospel separação casamento lista',
      'historia pastores divorciados igreja evangélica brasil'
    ]
    : montarConsultasInvestigativa(palavrasChave, formato);

  const buscasConsulta = consultas.flatMap((q) => [
    executarBuscaBraveWeb(q, palavrasChave, diasRecentes),
    semFiltro
      ? buscarGoogleNewsHistorico(q, 12).catch(() => [])
      : buscarGoogleNews(q, 8, { dias: Math.min(diasBusca, 30) }).catch(() => []),
    executarBuscaWebBrave(q)
  ]);

  const lotesBase = onda === 1
    ? await Promise.all([
      pesquisarNichos(palavrasChave, 10, {
        incluirRedesSociais: false,
        somenteRedesSociais: false,
        somenteRecentes: !semFiltro,
        diasRecentes: semFiltro ? '365' : diasRecentes,
        conteudoInternacional: false,
        incluirGoogleTrends: false,
        buscaAmpliada: true
      }),
      buscarBraveNews(palavrasChave, 15, semFiltro ? 365 : Math.min(diasBusca, 30)).catch(() => []),
      semFiltro
        ? buscarGoogleNewsHistorico(palavrasChave, 20)
        : buscarGoogleNews(palavrasChave, 12, { dias: Math.min(diasBusca, 30) }).catch(() => []),
      buscarWebGospel(palavrasChave, 15, semFiltro ? 365 : Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
      buscarPortaisGospel(palavrasChave, 15, semFiltro ? 365 : Math.min(diasBusca, 30), { ampliado: true }).catch(() => []),
      ...buscasConsulta
    ])
    : await Promise.all(buscasConsulta);

  const brutos = mesclarResultados(lotesBase.flat(2));

  const relaxado = semFiltro || onda === 2;
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
  const comLink = apurados.filter((a) => a.link && !a.redeSocial).slice(0, MAX_APURACAO_PROFUNDA);
  const lote = 4;

  for (let i = 0; i < comLink.length; i += lote) {
    const fatia = comLink.slice(i, i + lote);
    await Promise.all(fatia.map(async (item) => {
      try {
        const { corpo, titulo } = await extrairCorpoArtigo(item.link);
        if (corpo) {
          item.corpoProfundo = corpo.slice(0, 12000);
          if (titulo && !item.titulo) item.titulo = titulo;
        }
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

function montarContextoInvestigativo(palavrasChave, apurados, { formato, nomesApurados, contextoFactual }) {
  const linhas = [
    `TEMA OBRIGATÓRIO: ${palavrasChave}`,
    `FORMATO: ${formato === 'listagem_nomes' ? 'LISTAGEM — informar QUEM SÃO (nomes completos confirmados nas fontes)' : 'reportagem investigativa'}`,
    ''
  ];

  if (formato === 'listagem_nomes') {
    linhas.push(
      'REGRA CRÍTICA: Cite SOMENTE pessoas cujos nomes aparecem abaixo.',
      'NÃO invente nomes. NÃO use posts genéricos de redes como substituto.',
      nomesApurados.length
        ? `NOMES CONFIRMADOS (${nomesApurados.length}): ${nomesApurados.join('; ')}`
        : 'NOMES CONFIRMADOS: nenhum — diga ao leitor que a apuração não confirmou nomes.',
      ''
    );
  }

  if (contextoFactual) {
    linhas.push('=== APURAÇÃO WEB (Brave LLM) ===');
    linhas.push(contextoFactual.slice(0, 5000));
    linhas.push('');
  }

  linhas.push(`Matérias e fontes lidas (${apurados.length}):`);

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

  let fontesBrutas = await buscarFontesInvestigativa(chave, { ...opcoes, formato, onda: 1 });
  const contextoFactual = await buscarContextoFactual(chave, formato);

  let apurados = await Promise.all(fontesBrutas.map((item) => apurarTopico(item)));
  apurados = await apuracaoProfunda(apurados);

  let nomesApurados = extrairNomesApuracao(apurados, contextoFactual || '');

  if (formato === 'listagem_nomes' && nomesApurados.length < 2) {
    const fontesOnda2 = await buscarFontesInvestigativa(chave, { ...opcoes, formato, onda: 2 });
    const novos = fontesOnda2.filter((f) => !apurados.some((a) => a.link === f.link || titulosSimilares(a.titulo, f.titulo)));
    if (novos.length) {
      const apurados2 = await Promise.all(novos.map((item) => apurarTopico(item)));
      const profundos2 = await apuracaoProfunda(apurados2);
      apurados = [...apurados, ...profundos2];
      nomesApurados = extrairNomesApuracao(apurados, contextoFactual || '');
    }
  }

  if (formato === 'listagem_nomes' && nomesApurados.length < MIN_NOMES_LISTAGEM) {
    throw new Error(
      `Apuração profunda: ${apurados.length} matérias lidas, mas nenhum nome de pastor divorciado foi confirmado nas fontes. ` +
      'Esse tema pode não ter cobertura jornalística com nomes públicos — tente buscar um pastor específico (ex.: "pastor [nome] divórcio").'
    );
  }

  const todasFontes = deduplicarFontesApuracao(apurados.flatMap((a) => a.fontesApuracao || []));
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
      ? `Listagem apurada: ${nomesApurados.length} nome(s) em ${apurados.length} matérias lidas.`
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
  normalizarPalavrasChave,
  detectarFormatoInvestigativa,
  extrairNomesApuracao,
  artigoCitaNomesApurados
};
