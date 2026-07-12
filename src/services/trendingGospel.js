/**
 * "Em alta agora" — radar de assuntos quentes do nicho gospel.
 *
 * Varre notícias, portais gospel, Google Trends e redes sociais nas últimas
 * horas, agrupa itens que falam do MESMO assunto (títulos similares) e ranqueia
 * pela força do sinal: quanto mais veículos/fontes distintos cobrindo o mesmo
 * tema, mais "em alta" ele está.
 */
const {
  buscarEmAlta,
  buscarGoogleNews24h,
  buscarBraveNews,
  buscarPortaisGospel,
  buscarRedesSociais,
  itemQualidadeValida,
  itemEhRecente
} = require('./newsResearch');
const { buscarGoogleTrends } = require('./googleTrends');
const { titulosSimilares } = require('../utils/topicMatch');

const TERMOS_RADAR = [
  'gospel',
  'pastor',
  'igreja evangélica',
  'cantor gospel',
  'louvor'
];

const MAX_TOPICOS = 15;

function pesoTipoFonte(item) {
  if (item.emAlta) return 4;
  if (item.tipoFonte === 'rede_social' || item.redeSocial) return 3;
  if (item.tipoFonte === 'portal_gospel') return 2;
  return 2; // notícia comum
}

function nomeVeiculo(item) {
  const v = item.veiculo || item.fonte || '';
  return String(v).trim().toLowerCase();
}

/** Agrupa itens que falam do mesmo assunto e soma o "calor" do grupo. */
function agruparPorAssunto(itens) {
  const grupos = [];

  for (const item of itens) {
    const grupo = grupos.find((g) => titulosSimilares(g.principal.titulo, item.titulo));
    if (grupo) {
      grupo.itens.push(item);
      // O item com link de notícia mais completo vira o representante do grupo
      const melhor = item.tipoFonte !== 'rede_social' && (grupo.principal.tipoFonte === 'rede_social' || (item.resumo || '').length > (grupo.principal.resumo || '').length);
      if (melhor) grupo.principal = item;
    } else {
      grupos.push({ principal: item, itens: [item] });
    }
  }

  return grupos.map((g) => {
    const veiculos = new Set(g.itens.map(nomeVeiculo).filter(Boolean));
    const temRede = g.itens.some((i) => i.tipoFonte === 'rede_social' || i.redeSocial);
    const temTrend = g.itens.some((i) => i.emAlta || /trends/i.test(i.fonte || ''));
    const calor = g.itens.reduce((soma, i) => soma + pesoTipoFonte(i), 0)
      + veiculos.size * 3
      + (temTrend ? 5 : 0)
      + (temRede ? 2 : 0);

    return {
      ...g.principal,
      emAltaAgora: true,
      emAlta: true,
      calor,
      contagemFontes: g.itens.length,
      veiculos: [...new Set(g.itens.map((i) => i.veiculo || i.fonte).filter(Boolean))].slice(0, 5),
      sinalRedes: temRede,
      sinalTrends: temTrend
    };
  });
}

/**
 * Busca o que está em alta AGORA no nicho gospel.
 * @param {string} termosExtras palavras-chave opcionais digitadas pelo usuário
 * @param {object} opcoes { horas: 24|48 }
 */
async function buscarEmAltaAgora(termosExtras = '', opcoes = {}) {
  const horas = opcoes.horas === 48 || opcoes.horas === '48' ? 48 : 24;
  const dias = horas / 24;
  const termos = [...TERMOS_RADAR];

  String(termosExtras || '')
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .forEach((t) => {
      if (!termos.some((x) => x.toLowerCase() === t.toLowerCase())) termos.push(t);
    });

  const promessas = [];
  for (const termo of termos.slice(0, 8)) {
    promessas.push(buscarEmAlta(termo, 6).catch(() => []));
    promessas.push(buscarGoogleNews24h(termo, 6).catch(() => []));
    promessas.push(buscarBraveNews(termo, 6, dias).catch(() => []));
    promessas.push(buscarGoogleTrends(termo, 5).catch(() => []));
  }
  // Portais e redes só nos termos principais (chamadas mais pesadas)
  for (const termo of termos.slice(0, 3)) {
    promessas.push(buscarPortaisGospel(termo, 5, dias).catch(() => []));
    promessas.push(buscarRedesSociais(termo, 8, dias, { modoAmpliado: true }).catch(() => []));
  }

  const lotes = await Promise.all(promessas);
  const brutos = lotes.flat()
    .filter((item) => item && item.titulo)
    .filter((item) => itemQualidadeValida(item))
    .filter((item) => itemEhRecente(item, { horas }) || item.emAlta || /trends/i.test(item.fonte || ''));

  const grupos = agruparPorAssunto(brutos)
    .sort((a, b) => b.calor - a.calor)
    .slice(0, MAX_TOPICOS)
    .map((topico, idx) => ({ ...topico, posicao: idx + 1 }));

  return {
    topicos: grupos,
    totalAnalisado: brutos.length,
    horas
  };
}

module.exports = { buscarEmAltaAgora };
