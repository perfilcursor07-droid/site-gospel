const { pesquisarNichos, apurarTopico } = require('./newsResearch');
const { titulosSimilares } = require('../utils/topicMatch');

const MAX_FONTES_APURAR = 10;
const MAX_FONTES_CONTEXTO = 15;

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
  const termos = palavrasChave
    .split(/[,;\n]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
  const texto = `${item.titulo || ''} ${item.resumo || ''} ${item.conteudoRede || ''} ${item.nicho || ''}`.toLowerCase();
  let score = 0;
  for (const termo of termos) {
    if (texto.includes(termo)) score += termo.split(/\s+/).length >= 2 ? 4 : 2;
  }
  if (item.emAlta) score += 3;
  if (item.redeSocial || item.tipoFonte === 'rede_social') score += 2;
  if ((item.resumo || '').length > 80) score += 1;
  if (item.contextoApuracao) score += 2;
  return score;
}

function montarContextoInvestigativo(palavrasChave, apurados) {
  const linhas = [
    `PAUTA INVESTIGATIVA — palavras-chave: ${palavrasChave}`,
    `Objetivo: matéria original com furo de reportagem cruzando ${apurados.length} fontes apuradas na internet.`,
    'INSTRUÇÃO: Sintetize os fatos de TODAS as fontes. Cada fonte traz um ângulo; reescreva 100% — nunca copie frases literais.',
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

  const topicos = await pesquisarNichos(palavrasChave, 10, {
    incluirRedesSociais,
    somenteRedesSociais: false,
    somenteRecentes: diasRecentes !== 'tudo',
    diasRecentes,
    conteudoInternacional,
    incluirGoogleTrends: true,
    buscaAmpliada: true
  });

  if (!topicos.length) {
    throw new Error(
      'Nenhuma fonte encontrada para essas palavras-chave. Tente termos mais específicos ou amplie o período.'
    );
  }

  const ordenados = [...topicos].sort(
    (a, b) => pontuarRelevanciaInvestigativa(b, palavrasChave) - pontuarRelevanciaInvestigativa(a, palavrasChave)
  );

  const selecionados = [];
  for (const item of ordenados) {
    if (selecionados.length >= MAX_FONTES_APURAR) break;
    if (selecionados.some((s) => titulosSimilares(s.titulo, item.titulo))) continue;
    selecionados.push(item);
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
