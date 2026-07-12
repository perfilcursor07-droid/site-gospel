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

/**
 * Sorteia uma faixa de palavras por matéria para evitar que todas as
 * publicações tenham extensão quase idêntica (padrão típico de conteúdo em massa).
 */
function sortearFaixaPalavras() {
  const alvos = [
    { min: 500, max: 650 },
    { min: 550, max: 750 },
    { min: 650, max: 850 },
    { min: 700, max: 950 }
  ];
  return alvos[Math.floor(Math.random() * alvos.length)];
}

/**
 * Sorteia uma variação de estrutura para a matéria (nº de subtítulos,
 * uso de lista, posição do contexto) — evita template fixo detectável.
 */
function sortearEstruturaArtigo() {
  const estruturas = [
    'Use 2 subtítulos <h2>. Sem listas.',
    'Use 3 subtítulos <h2> curtos. Sem listas.',
    'Use 2 subtítulos <h2> e UMA lista <ul> curta (3–4 itens) onde fizer sentido (ex.: pontos principais, cronologia).',
    'Use 2 subtítulos <h2>. Inclua um parágrafo curto de contexto histórico ANTES do primeiro <h2>.',
    'Use 3 subtítulos <h2>. O último deve ser sobre repercussão ou próximos passos.'
  ];
  return estruturas[Math.floor(Math.random() * estruturas.length)];
}

/**
 * Sorteia o estilo do lead (1º parágrafo) — evita que todas as matérias
 * abram do mesmo jeito ("Fulano fez X nesta terça...").
 */
function sortearEstiloLead() {
  const estilos = [
    'Abra pelo FATO direto: o que aconteceu, quem e onde, em uma frase forte.',
    'Abra pela CONSEQUÊNCIA/repercussão: o efeito que o fato causou, e só depois explique o que houve.',
    'Abra por um DETALHE concreto e específico das fontes (número, local, data, frase dita) e amarre ao fato principal.',
    'Abra pelo CONTRASTE: o que se esperava versus o que de fato aconteceu.',
    'Abra situando o LEITOR no momento: quando e onde o fato veio à tona, e por que importa agora.'
  ];
  return estilos[Math.floor(Math.random() * estilos.length)];
}

/**
 * Sorteia o estilo da manchete — varia o formato do título entre matérias.
 */
function sortearEstiloTitulo() {
  const estilos = [
    'Manchete direta e factual (sujeito + verbo + fato).',
    'Manchete com o dado ou detalhe mais forte da apuração em evidência.',
    'Manchete de duas partes separadas por ponto e vírgula ou dois-pontos (fato; desdobramento).',
    'Manchete começando pelo desdobramento ou consequência do fato.',
    'Manchete com citação indireta ou termo-chave entre aspas simples, se houver fala relevante nas fontes.'
  ];
  return estilos[Math.floor(Math.random() * estilos.length)];
}

const FRASES_PROIBIDAS_IA = [
  'é importante ressaltar', 'vale ressaltar', 'vale destacar', 'vale lembrar',
  'nesse sentido', 'diante disso', 'em suma', 'em resumo', 'por fim',
  'além disso', 'no entanto, é', 'cabe destacar', 'é fundamental',
  'desempenha um papel', 'cenário atual', 'nos dias de hoje',
  'não podemos esquecer', 'sem dúvida', 'com certeza', 'de fato,',
  'mergulhar', 'navegar por', 'panorama geral', 'era digital'
];

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

ESCRITA HUMANA (OBRIGATÓRIO — evite marcas de texto automatizado):
- PROIBIDO usar estas muletas: ${FRASES_PROIBIDAS_IA.map((f) => `"${f}"`).join(', ')}.
- Varie o comprimento das frases: misture frases curtas (impacto) com médias. Nunca 4 frases seguidas do mesmo tamanho.
- Comece parágrafos de formas diferentes — nunca dois parágrafos seguidos começando com o mesmo tipo de palavra (nome, gerúndio, "O", "A").
- Use detalhes concretos quando disponíveis nas fontes: cidade, igreja, dia da semana, número exato — em vez de generalidades.
- Escreva transições naturais de repórter, não conectivos escolares.
- O fechamento NUNCA deve resumir o texto ("como vimos...") — termine com fato, desdobramento ou expectativa.

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
  mensagemAvisoQualidade,
  sortearFaixaPalavras,
  sortearEstruturaArtigo,
  sortearEstiloLead,
  sortearEstiloTitulo,
  FRASES_PROIBIDAS_IA
};
