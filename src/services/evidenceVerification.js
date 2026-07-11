const { filtrarEvidenciasInvestigativas } = require('./deepseek');

/** Divórcio/separação afirmados explicitamente — não inferência. */
const RX_DIVORCIO_EXPLICITO = /divorci(?:ou|ada|ado|ar|aram|o)|divórcio|separou|separa(?:ção|cao)|dissolu(?:ção|cao)\s+do|fim\s+do\s+casamento|termin(?:ou|aram)\s+o\s+casamento|anunciou\s+(?:a\s+)?separa/i;

/** Padrões que só sugerem divórcio sem afirmar — rejeitar se não houver termo explícito. */
const RX_SUGESTAO_FRACA = /primeira\s+esposa|primeiro\s+casamento|casou\s+novamente|antes\s+de\s+se\s+casar|atual\s+esposa|ex-esposa|ex\s+esposa/i;

const VEICULOS_NAO_DOCUMENTAIS = /apuração web|brave|contexto web|llm|treinamento/i;

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
  const partes = normalizar(nome).split(/\s+/).filter(Boolean);
  if (partes.length < 2) return false;
  const stop = new Set(['mateus', 'timoteo', 'deus', 'cristo', 'igreja', 'gospel', 'brasil', 'senhor', 'universal']);
  if (partes.some((p) => stop.has(p))) return false;
  return true;
}

function nomeNaSentenca(nome, sentenca) {
  const partes = nome.split(/\s+/).filter((p) => p.length > 2);
  const texto = normalizar(sentenca);
  const hits = partes.filter((p) => texto.includes(normalizar(p)));
  return hits.length >= Math.min(2, partes.length);
}

function extrairNomesNaSentenca(sentenca) {
  const nomes = new Set();
  const padroes = [
    /pastor(?:a)?\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+(?:de|da|do|dos|das)\s+)?[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)/g,
    /(?:apóstolo|bispo|pregador)\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)/gi,
    /([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+(?:\s+[A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][a-zà-ú]+)?)\s+(?:se\s+)?divorciou/gi
  ];
  for (const rx of padroes) {
    for (const m of sentenca.matchAll(rx)) {
      const n = capitalizarNome((m[1] || '').replace(/\s*(divorciou|separou).*$/i, '').trim());
      if (nomeValido(n)) nomes.add(n);
    }
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

function coletarBlocosDocumentais(apurados) {
  const blocos = [];
  for (const item of apurados) {
    if (item.corpoProfundo && item.link && item.link.startsWith('http')) {
      blocos.push({
        texto: item.corpoProfundo,
        url: item.link,
        veiculo: item.veiculo || item.fonte || 'Portal',
        titulo: item.titulo
      });
    }
    for (const f of item.fontesApuracao || []) {
      if (!f.url || !f.trecho || !f.url.startsWith('http')) continue;
      if (VEICULOS_NAO_DOCUMENTAIS.test(f.veiculo || '')) continue;
      if (/news\.google\.com/.test(f.url)) continue;
      blocos.push({
        texto: f.trecho,
        url: f.url,
        veiculo: f.veiculo || 'Fonte',
        titulo: f.titulo
      });
    }
  }
  return blocos;
}

function extrairEvidenciasDocumentais(apurados) {
  const blocos = coletarBlocosDocumentais(apurados);
  const evidencias = [];
  const vistos = new Set();

  for (const bloco of blocos) {
    const sentencas = bloco.texto
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25);

    for (let i = 0; i < sentencas.length; i++) {
      const janela = sentencas.slice(Math.max(0, i - 1), i + 2).join(' ');
      if (!sentencaConfirmaDivorcio(janela)) continue;

      const nomes = extrairNomesNaSentenca(janela);
      for (const nome of nomes) {
        if (!nomeNaSentenca(nome, janela)) continue;
        const chave = `${normalizar(nome)}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        evidencias.push({
          nome,
          trecho: janela.slice(0, 480),
          url: bloco.url,
          veiculo: bloco.veiculo,
          tituloFonte: bloco.titulo
        });
      }
    }
  }

  return evidencias;
}

async function obterEvidenciasVerificadas(apurados, tema) {
  const brutas = extrairEvidenciasDocumentais(apurados);
  if (!brutas.length) return [];

  try {
    const confirmadas = await filtrarEvidenciasInvestigativas(brutas, tema);
    return confirmadas.length ? confirmadas : brutas;
  } catch (e) {
    console.warn('obterEvidenciasVerificadas IA:', e.message);
    return brutas;
  }
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
    linhas.push(`${i + 1}. NOME: ${ev.nome}`);
    linhas.push(`   VEÍCULO: ${ev.veiculo || 'Portal'}`);
    linhas.push(`   URL: ${ev.url}`);
    linhas.push(`   TRECHO (fato explícito — reescreva, não copie): ${ev.trecho}`);
    linhas.push('');
  });
  return linhas.join('\n');
}

function artigoRespeitaEvidencias(artigo, evidencias) {
  if (!evidencias?.length) return true;
  const permitidos = new Set(evidencias.map((e) => normalizar(e.nome)));
  const h2s = [...String(artigo.conteudo || '').matchAll(/<h2[^>]*>([^<]+)/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const extras = h2s.filter((h) => !permitidos.has(normalizar(h)));
  return extras.length === 0;
}

module.exports = {
  extrairEvidenciasDocumentais,
  obterEvidenciasVerificadas,
  montarBlocoEvidencias,
  artigoRespeitaEvidencias,
  sentencaConfirmaDivorcio
};
