const { filtrarEvidenciasInvestigativas } = require('./deepseek');

const RX_DIVORCIO_EXPLICITO = /divorci(?:ou|ada|ado|ar|aram|o|am)|divórcio|separou|separa(?:ção|cao|r)|dissolu(?:ção|cao)\s+do|fim\s+do\s+casamento|termin(?:ou|aram)\s+o\s+casamento|anunciou\s+(?:o\s+)?(?:seu\s+)?(?:divórcio|separa)|encerr(?:ou|aram)\s+o\s+casamento|p[oô]s\s+fim\s+ao\s+casamento|romp(?:eu|eram)\s+o\s+casamento|por\s+fim\s+ao\s+matrim/i;

const RX_SUGESTAO_FRACA = /primeira\s+esposa|primeiro\s+casamento|casou\s+novamente|antes\s+de\s+se\s+casar|atual\s+esposa/i;

const VEICULOS_NAO_DOCUMENTAIS = /apuração web|brave search|contexto web|llm|treinamento/i;

const PORTAIS_CONFIaveis = /guiame|gospelprime|portaldogospel|folhagospel|panorama|pleno\.news|agenciaelos|supergospel|verdadegospel|g1\.globo|uol|terra|r7|metropoles|ig\.com/i;

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const RX_VERBO_ACAO = /\s+(?:anunciou|anuncia|confirmou|confirma|divorciou|separou|encerrou|terminou|rompeu|pos|pôs|reve|revelou|disse|declarou|publicou|postou|escreveu|comunicou|informou|relatou|contou|explicou|falou|negou|admite|admitiu|decidiu|optou|busca|buscou|volta|voltou|casou|casará|casara|morreu|faleceu|nasceu|criou|fundou|lidera|pastoreia|ministra|prega|cantou|canta|grava|lançou|lancou|da|de|do|dos|das|em|no|na|com|para|por|sobre|após|apos|depois|antes|durante|contra|entre|sobre|sobre|sobre).*$/i;

const RX_IGREJA_SUFIXO = /\s+(?:da|de|do)\s+(?:igreja|lagoinha|universal|batista|presbiteriana|metodista|adventista|quadrangular|renovo|videira|sara|sara\s+nossa\s+terra|comunidade|ministerio|ministério|templo|congregacao|congregação).*$/i;

const H2_SECOES_PERMITIDAS = /^(contexto|conclus[aã]o|conclusao|impacto|panorama|repercuss[aã]o|repercussao|desdobramento|pr[oó]ximos passos|reflex[aã]o|reflexao|entenda|panorama|o caso|fechamento|s[ií]ntese|leitura|bastidores|reacoes|reações)$/i;

function limparTituloReligioso(nome) {
  return String(nome || '')
    .replace(/^(?:pastor(?:a)?|bispo|apóstolo|apostolo|pregador|cantor(?:a)?(?:\s+gospel)?)\s+/i, '')
    .trim();
}

function capitalizarNome(nome) {
  let limpo = limparTituloReligioso(String(nome || '').trim())
    .replace(RX_VERBO_ACAO, '')
    .replace(RX_IGREJA_SUFIXO, '')
    .replace(/\s*(divorciou|separou|anunciou).*$/i, '')
    .trim();

  return limpo
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((p) => (p.length <= 2 && /^(de|da|do|dos|das|e)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join(' ');
}

function nomeValido(nome) {
  if (!nome || nome.length < 5) return false;
  const partes = normalizar(nome).split(/\s+/).filter(Boolean);
  if (partes.length < 2) return false;
  const stop = new Set([
    'mateus', 'timoteo', 'deus', 'cristo', 'igreja', 'gospel', 'brasil', 'senhor', 'universal',
    'evangelico', 'evangélico', 'noticias', 'portal', 'reporter', 'redacao', 'editoria'
  ]);
  if (partes.some((p) => stop.has(p))) return false;
  if (/^(que|sao|são|veja|lista|confira|conheca|conheça)/i.test(nome)) return false;
  return true;
}

function nomeNaSentenca(nome, sentenca) {
  const partes = nome.split(/\s+/).filter((p) => p.length > 2);
  const texto = normalizar(sentenca);
  const hits = partes.filter((p) => texto.includes(normalizar(p)));
  if (partes.length >= 2) return hits.length >= 2 || (hits.length >= 1 && hits.some((h) => h.length >= 5));
  return hits.length >= 1;
}

function extrairNomesNaSentenca(sentenca) {
  const nomes = new Set();
  const bruto = String(sentenca || '');

  const padroes = [
    /(?:pastor(?:a)?|apóstolo|apostolo|bispo|pregador|cantor(?:a)?\s+gospel)\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}(?:\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}){0,2})/gi,
    /([A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}(?:\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,})?)\s+(?:se\s+)?(?:divorciou|separou|anunciou\s+(?:o\s+)?(?:divórcio|divorcio|separação|separacao))/gi,
    /(?:^|[\n•\-–\d.)]+)\s*(?:Pastor(?:a)?\s+)?([A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}(?:\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,})?)/gm
  ];

  for (const rx of padroes) {
    for (const m of bruto.matchAll(rx)) {
      const n = capitalizarNome(m[1]);
      if (nomeValido(n) && !/^(Pastor|Pastora|Bispo|Apostolo|Apóstolo|Anuncia|Anunciou|Confirmou|Separou|Divorciou)$/i.test(n)) {
        nomes.add(n);
      }
    }
  }

  // "divórcio de X" / "separação de X"
  for (const m of bruto.matchAll(/(?:divórcio|divorcio|separação|separacao)\s+(?:de|com|do|da)\s+(?:pastor(?:a)?\s+)?([A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}(?:\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'-]{1,}){0,2})/gi)) {
    const n = capitalizarNome(m[1]);
    if (nomeValido(n)) nomes.add(n);
  }

  return [...nomes];
}

function sentencaConfirmaDivorcio(sentenca) {
  if (!RX_DIVORCIO_EXPLICITO.test(sentenca)) return false;
  if (RX_SUGESTAO_FRACA.test(sentenca) && !/divorci|divórcio|separou|separa(?:ção|cao)/i.test(sentenca)) {
    return false;
  }
  return true;
}

function urlDocumental(url) {
  if (!url || !url.startsWith('http')) return false;
  if (/news\.google\.com\/rss|google\.com\/url\?/i.test(url)) return false;
  return true;
}

function coletarBlocosDocumentais(apurados) {
  const blocos = [];

  for (const item of apurados) {
    const url = item.linkOriginal || item.link;
    if (!urlDocumental(url)) continue;

    const textoCompleto = [
      item.titulo ? `TÍTULO: ${item.titulo}` : '',
      item.resumo ? `RESUMO: ${item.resumo}` : '',
      item.corpoProfundo || ''
    ].filter(Boolean).join('\n\n');

    if (textoCompleto.length > 15) {
      blocos.push({
        texto: textoCompleto,
        url,
        veiculo: item.veiculo || item.fonte || 'Portal',
        titulo: item.titulo,
        confiavel: PORTAIS_CONFIaveis.test(url) || PORTAIS_CONFIaveis.test(item.veiculo || '')
      });
    }

    for (const f of item.fontesApuracao || []) {
      if (!f.url || !urlDocumental(f.url)) continue;
      if (VEICULOS_NAO_DOCUMENTAIS.test(f.veiculo || '')) continue;
      const txt = [f.titulo, f.resumo, f.trecho].filter(Boolean).join(' ');
      if (txt.length < 20) continue;
      blocos.push({
        texto: txt,
        url: f.url,
        veiculo: f.veiculo || 'Fonte',
        titulo: f.titulo || item.titulo,
        confiavel: PORTAIS_CONFIaveis.test(f.url)
      });
    }
  }

  return blocos;
}

function registrarEvidencia(evidencias, vistos, { nome, trecho, url, veiculo, tituloFonte, confiavel }) {
  if (!nomeValido(nome) || !nomeNaSentenca(nome, trecho)) return;
  const chave = normalizar(nome);
  const existente = evidencias.find((e) => normalizar(e.nome) === chave || normalizar(e.nome).startsWith(chave) || chave.startsWith(normalizar(e.nome)));
  if (existente) return;
  if (vistos.has(chave)) return;
  vistos.add(chave);
  evidencias.push({
    nome,
    trecho: trecho.slice(0, 520),
    url,
    veiculo,
    tituloFonte,
    confiavel: !!confiavel
  });
}

function extrairEvidenciasDocumentais(apurados) {
  const blocos = coletarBlocosDocumentais(apurados);
  const evidencias = [];
  const vistos = new Set();

  blocos.sort((a, b) => (b.confiavel ? 1 : 0) - (a.confiavel ? 1 : 0));

  for (const bloco of blocos) {
    if (bloco.titulo && sentencaConfirmaDivorcio(bloco.titulo)) {
      for (const nome of extrairNomesNaSentenca(bloco.titulo)) {
        registrarEvidencia(evidencias, vistos, {
          nome,
          trecho: bloco.titulo,
          url: bloco.url,
          veiculo: bloco.veiculo,
          tituloFonte: bloco.titulo,
          confiavel: bloco.confiavel
        });
      }
    }

    const sentencas = bloco.texto
      .split(/(?<=[.!?])\s+|\n+|;\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    for (let i = 0; i < sentencas.length; i++) {
      const janela = sentencas.slice(Math.max(0, i - 1), i + 2).join(' ');
      if (!sentencaConfirmaDivorcio(janela)) continue;

      for (const nome of extrairNomesNaSentenca(janela)) {
        registrarEvidencia(evidencias, vistos, {
          nome,
          trecho: janela,
          url: bloco.url,
          veiculo: bloco.veiculo,
          tituloFonte: bloco.titulo,
          confiavel: bloco.confiavel
        });
      }
    }
  }

  return evidencias.sort((a, b) => (b.confiavel ? 1 : 0) - (a.confiavel ? 1 : 0));
}

function consolidarEvidencias(evidencias) {
  const map = new Map();
  for (const ev of evidencias || []) {
    if (!ev?.nome) continue;
    const chave = normalizar(limparTituloReligioso(ev.nome));
    const existente = map.get(chave);
    if (
      !existente
      || (ev.confiavel && !existente.confiavel)
      || String(ev.trecho || '').length > String(existente.trecho || '').length
    ) {
      map.set(chave, { ...ev, nome: limparTituloReligioso(capitalizarNome(ev.nome)) || ev.nome });
    }
  }
  return [...map.values()].sort((a, b) => (b.confiavel ? 1 : 0) - (a.confiavel ? 1 : 0));
}

function h2EhSecaoGenerica(h2) {
  const t = normalizar(String(h2 || '').trim().replace(/<[^>]+>/g, ''));
  return H2_SECOES_PERMITIDAS.test(t) || t.length < 4;
}

function h2PareceNomePessoa(h2) {
  const limpo = limparTituloReligioso(String(h2 || '').trim().replace(/<[^>]+>/g, ''));
  const partes = limpo.split(/\s+/).filter(Boolean);
  if (partes.length < 2 || partes.length > 5) return false;
  if (h2EhSecaoGenerica(h2)) return false;
  return partes.every((p) => /^[A-Za-zÀ-ú'-]{2,}$/.test(p));
}

function nomePermitidoNoH2(h2, permitidos) {
  const limpo = normalizar(limparTituloReligioso(String(h2 || '').trim().replace(/<[^>]+>/g, '')));
  if (!limpo) return false;

  for (const p of permitidos) {
    const np = normalizar(p);
    if (limpo === np) return true;
    if (limpo.includes(np) || np.includes(limpo)) return true;

    const partesP = np.split(/\s+/).filter((w) => w.length > 2);
    const partesH = limpo.split(/\s+/).filter((w) => w.length > 2);
    const coincidencias = partesP.filter((w) => partesH.includes(w));
    if (coincidencias.length >= 2) return true;
    if (coincidencias.length >= 1 && partesP.length === 2 && partesH.length === 2) return true;
  }
  return false;
}

function listarH2Invalidos(artigo, evidencias) {
  if (!evidencias?.length) return [];
  const permitidos = consolidarEvidencias(evidencias).map((e) => e.nome);
  const h2s = [...String(artigo.conteudo || '').matchAll(/<h2[^>]*>([^<]+)/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  return h2s.filter((h) => h2PareceNomePessoa(h) && !nomePermitidoNoH2(h, permitidos));
}

async function obterEvidenciasVerificadas(apurados, tema) {
  const brutas = consolidarEvidencias(extrairEvidenciasDocumentais(apurados));
  if (!brutas.length) return [];

  try {
    const confirmadas = consolidarEvidencias(await filtrarEvidenciasInvestigativas(brutas, tema));
    if (confirmadas.length) return confirmadas;
  } catch (e) {
    console.warn('obterEvidenciasVerificadas IA:', e.message);
  }

  return brutas;
}

function montarBlocoEvidencias(evidencias) {
  if (!evidencias.length) {
    return 'EVIDÊNCIAS DOCUMENTAIS: NENHUMA com divórcio explicitamente confirmado em matéria lida. Não liste pessoas.';
  }
  const linhas = [
    `EVIDÊNCIAS DOCUMENTAIS (${evidencias.length}) — escreva SOMENTE sobre estas pessoas:`,
    'Cada item foi lido em matéria/portal com URL real. Não inclua ninguém fora desta lista.',
    'Não infle a quantidade no lead (use o número exato abaixo).',
    ''
  ];
  evidencias.forEach((ev, i) => {
    linhas.push(`${i + 1}. NOME: ${ev.nome}${ev.confiavel ? ' [fonte confiável]' : ''}`);
    linhas.push(`   VEÍCULO: ${ev.veiculo || 'Portal'}`);
    linhas.push(`   URL: ${ev.url}`);
    linhas.push(`   TRECHO (fato explícito — reescreva, não copie): ${ev.trecho}`);
    linhas.push('');
  });
  return linhas.join('\n');
}

function artigoRespeitaEvidencias(artigo, evidencias) {
  return listarH2Invalidos(artigo, evidencias).length === 0;
}

module.exports = {
  extrairEvidenciasDocumentais,
  obterEvidenciasVerificadas,
  consolidarEvidencias,
  montarBlocoEvidencias,
  artigoRespeitaEvidencias,
  listarH2Invalidos,
  sentencaConfirmaDivorcio
};
