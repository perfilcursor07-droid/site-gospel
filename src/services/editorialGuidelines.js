/**
 * Critérios editoriais alinhados a:
 * - Google Search Central: "Creating helpful, reliable, people-first content"
 * - E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)
 * - Políticas anti-spam: sem scaled content abuse nem conteúdo só para ranking
 * Referência: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
 */

/** Mínimo para não ser "thin content" em notícia */
const MIN_PALAVRAS_ARTIGO = 500;
/** Faixa ideal — reportagem gospel enxuta (estilo portal de notícias) */
const IDEAL_MIN_PALAVRAS = 550;
const IDEAL_MAX_PALAVRAS = 850;
/** Teto — evita matérias inchadas que prejudicam leitura e UX */
const MAX_PALAVRAS_ARTIGO = 950;

function contarPalavrasConteudo(html) {
  const texto = (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return 0;
  return texto.split(/\s+/).filter(Boolean).length;
}

function avaliarComprimento(conteudo) {
  const palavras = contarPalavrasConteudo(conteudo);
  return {
    palavras,
    curto: palavras < MIN_PALAVRAS_ARTIGO,
    longo: palavras > MAX_PALAVRAS_ARTIGO,
    ok: palavras >= MIN_PALAVRAS_ARTIGO && palavras <= MAX_PALAVRAS_ARTIGO,
    ideal: palavras >= IDEAL_MIN_PALAVRAS && palavras <= IDEAL_MAX_PALAVRAS
  };
}

function blocoRegrasEditoriais(nomeSite = 'portal gospel') {
  return `
DIRETRIZES GOOGLE 2026 — CONTEÚDO ÚTIL, ORIGINAL E PEOPLE-FIRST (${nomeSite}):

PROPÓSITO (people-first):
- Escreva para o LEITOR evangélico brasileiro, não para manipular o Google.
- Responda de imediato: o que aconteceu, por que importa agora e qual o furo/repercussão.
- Cada parágrafo deve avançar a notícia; proibido encher linguiça, repetir ideias ou blocos genéricos de IA.

E-E-A-T (confiança em primeiro lugar):
- EXPERIÊNCIA: tom de redação que demonstra apuração jornalística real sobre o universo gospel.
- EXPERTISE: contexto correto sobre igreja, fé, eventos e sociedade evangélica no Brasil.
- AUTORIDADE: atribuição clara a fontes ("segundo relatos", "conforme publicação em...").
- CONFIANÇA: não invente fatos, números, datas nem citações entre aspas de pessoas reais.

REPORTAGEM COM FURO (permitido e desejado):
- Pode reportar assuntos com base em outras matérias, portais ou redes — como jornalismo de repercussão.
- Reescreva 100% com palavras próprias; NUNCA copie frases, leads ou trechos das fontes.
- Destaque o ângulo único: o que é novo, o que viralizou, impacto na comunidade gospel, próximos passos.
- Se a pauta veio de rede social, extraia fatos e repercussão com redação jornalística própria — use o conteúdo como base factual, sem transcrever postagens.

ORIGINALIDADE E ANTI-SPAM:
- Conteúdo único: estrutura, ordem dos fatos e redação próprias.
- Proibido: texto raso, massificado, repetitivo ou criado só para ranquear.
- Proibido: clickbait enganoso ou manchete que não corresponde ao texto.

EXTENSÃO (notícia enxuta e completa):
- Alvo: ${IDEAL_MIN_PALAVRAS}–${IDEAL_MAX_PALAVRAS} palavras (mín. ${MIN_PALAVRAS_ARTIGO}, máx. ${MAX_PALAVRAS_ARTIGO}).
- Estrutura: lead forte + 4 a 6 parágrafos <p> + 2 subtítulos <h2>.
- Parágrafos curtos a médios (2–4 frases). Sem seções encyclopédicas desnecessárias.

NICHO E CONFORMIDADE:
- Foco gospel/evangélico brasileiro; não desvie para temas aleatórios.
- Sem incitação ao ódio, discriminação ou violação de políticas do Google/AdSense.
- Manchete e meta description honestas, específicas e úteis para SEO.

REVISÃO:
- Texto pronto para revisão humana antes de publicação em massa.`;
}

function mensagemAvisoQualidade(avaliacao) {
  if (avaliacao.curto) {
    return `Texto com ${avaliacao.palavras} palavras (mínimo ${MIN_PALAVRAS_ARTIGO}). Complemente com contexto antes de publicar.`;
  }
  if (avaliacao.longo) {
    return `Texto com ${avaliacao.palavras} palavras (máximo recomendado ${MAX_PALAVRAS_ARTIGO}). Enxugue repetições antes de publicar.`;
  }
  return null;
}

module.exports = {
  MIN_PALAVRAS_ARTIGO,
  IDEAL_MIN_PALAVRAS,
  IDEAL_MAX_PALAVRAS,
  MAX_PALAVRAS_ARTIGO,
  contarPalavrasConteudo,
  avaliarComprimento,
  blocoRegrasEditoriais,
  mensagemAvisoQualidade
};
