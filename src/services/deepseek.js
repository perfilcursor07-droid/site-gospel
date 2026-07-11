const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const {
  blocoRegrasEditoriais,
  avaliarComprimento,
  MIN_PALAVRAS_ARTIGO,
  MAX_PALAVRAS_ARTIGO,
  IDEAL_MIN_PALAVRAS,
  IDEAL_MAX_PALAVRAS,
  contarPalavrasConteudo,
  mensagemAvisoQualidade
} = require('./editorialGuidelines');

function deduplicarEvidencias(evidencias) {
  const map = new Map();
  for (const ev of evidencias || []) {
    if (!ev?.nome) continue;
    const k = ev.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!map.has(k)) map.set(k, ev);
  }
  return [...map.values()];
}

function obterApiKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY não configurada no arquivo .env');
  return key;
}

async function chatCompletion(messages, opcoes = {}) {
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${obterApiKey()}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      stream: false,
      thinking: { type: 'disabled' },
      response_format: opcoes.json ? { type: 'json_object' } : undefined,
      temperature: opcoes.temperature ?? 0.82,
      max_tokens: opcoes.maxTokens ?? 6000
    })
  });

  if (!res.ok) {
    const erro = await res.text();
    throw new Error(`DeepSeek API (${res.status}): ${erro.slice(0, 300)}`);
  }

  const data = await res.json();
  const conteudo = data.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('Resposta vazia da DeepSeek API');
  return conteudo;
}

function normalizarArtigo(raw) {
  const artigo = typeof raw === 'string' ? parsearJson(raw) : raw;
  return {
    titulo: artigo.titulo || artigo.title || '',
    resumo: artigo.resumo || artigo.subtitulo || artigo.lead || '',
    conteudo: artigo.conteudo || artigo.content || '',
    meta_title: artigo.meta_title || artigo.metaTitle || artigo.titulo?.slice(0, 60),
    meta_description: artigo.meta_description || artigo.metaDescription || artigo.resumo?.slice(0, 160),
    termos_imagem: artigo.termos_imagem || artigo.termosImagem || artigo.image_keywords || '',
    assunto_imagem: artigo.assunto_imagem || artigo.assuntoImagem || '',
    pessoa_principal: artigo.pessoa_principal || artigo.pessoaPrincipal || null
  };
}

function textoPlano(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function gerarAltImagem({ titulo, resumo, assuntoImagem, pessoaPrincipal, metaImagem }) {
  const meta = String(metaImagem || '').replace(/\s+/g, ' ').trim();
  if (meta.length >= 10 && meta.length <= 125) {
    return meta.slice(0, 125);
  }

  const prompt = `Crie um texto alternativo (alt) curto para a capa desta matéria gospel.

TÍTULO DA MATÉRIA: ${titulo}
RESUMO: ${resumo || ''}
${metaImagem ? `TEXTO DA FONTE DA IMAGEM (priorize isto): ${metaImagem}` : ''}

REGRAS OBRIGATÓRIAS:
- Português do Brasil, máximo 125 caracteres
- NÃO invente pessoas, gestos, objetos ou cenas que não estejam confirmados
- Se não souber o que aparece na foto, use apenas o tema da matéria de forma neutra (ex.: "Congresso Nacional em Brasília" ou o título resumido)
- Sem aspas, sem prefixo "imagem de"

JSON: {"alt": "texto alt aqui"}`;

  const resposta = await chatCompletion(
    [
      { role: 'system', content: 'Você escreve alt text para SEO. Retorne somente JSON válido.' },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: 0.2, maxTokens: 200 }
  );

  const raw = typeof resposta === 'string' ? parsearJson(resposta) : resposta;
  const alt = (raw.alt || '').trim().slice(0, 125);
  return alt || `${titulo}`.slice(0, 125);
}

async function identificarCapaArtigo({ titulo, resumo, conteudo, pessoaPrincipal }) {
  const texto = textoPlano(conteudo).slice(0, 2800);
  const prompt = `Analise esta matéria jornalística gospel brasileira e defina a capa ideal.

TÍTULO: ${titulo}
RESUMO: ${resumo}
${pessoaPrincipal ? `PESSOA JÁ IDENTIFICADA: ${pessoaPrincipal}` : ''}

TEXTO DA MATÉRIA:
${texto || resumo}

Com base no texto COMPLETO (não invente pessoas que não aparecem), retorne JSON:
{
  "pessoa_principal": "nome completo da pastora/pastor/cantor central citado no texto, ou null",
  "assunto_imagem": "descrição precisa em português da foto ideal (quem aparece, o que faz, cenário, local). Se a pessoa for anônima, descreva a CENA (ex: homem em praça pública, resgate, comunidade) — NUNCA invente nome de pastor famoso",
  "termos_busca": ["3 a 6 buscas para encontrar a foto REAL desta notícia — use manchete, nome, cidade, evento"],
  "elementos_obrigatorios": ["palavras-chave do fato: nomes, cidades, eventos — ex: Goiás, pastora, igreja inclusiva"],
  "evitar": ["tipos de imagem irrelevantes: filme, série, stock genérico, igreja vazia, etc."]
}`;

  const resposta = await chatCompletion(
    [
      {
        role: 'system',
        content: 'Você é editor de arte de portal de notícias. Retorne somente JSON válido.'
      },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: 0.25, maxTokens: 900 }
  );

  try {
    const raw = typeof resposta === 'string' ? parsearJson(resposta) : resposta;
    return {
      pessoa_principal: raw.pessoa_principal || pessoaPrincipal || null,
      assunto_imagem: raw.assunto_imagem || '',
      termos_busca: Array.isArray(raw.termos_busca) ? raw.termos_busca.filter(Boolean) : [],
      elementos_obrigatorios: Array.isArray(raw.elementos_obrigatorios) ? raw.elementos_obrigatorios.filter(Boolean) : [],
      evitar: Array.isArray(raw.evitar) ? raw.evitar.filter(Boolean) : []
    };
  } catch (e) {
    console.warn('identificarCapaArtigo parse:', e.message);
    return {
      pessoa_principal: pessoaPrincipal || null,
      assunto_imagem: '',
      termos_busca: [],
      elementos_obrigatorios: [],
      evitar: []
    };
  }
}

async function validarImagemParaArtigo(
  { titulo, resumo, conteudo, assuntoImagem, pessoaPrincipal },
  candidato
) {
  if (!candidato?.url) return false;

  const textoMateria = textoPlano(conteudo).slice(0, 1200);
  const prompt = `Valide se esta IMAGEM CANDIDATA ilustra corretamente a matéria jornalística abaixo.

MATÉRIA:
TÍTULO: ${titulo}
RESUMO: ${resumo}
${assuntoImagem ? `FOTO IDEAL: ${assuntoImagem}` : ''}
${pessoaPrincipal ? `PESSOA CENTRAL: ${pessoaPrincipal}` : ''}
${textoMateria ? `TRECHO DO TEXTO:\n${textoMateria}` : ''}

IMAGEM CANDIDATA (metadados — você NÃO vê a foto, só descrição/URL):
- título: ${(candidato.title || candidato.alt || 'sem título').slice(0, 120)}
- URL: ${(candidato.url || '').slice(0, 120)}
- página de origem: ${(candidato.contextLink || candidato.source || 'desconhecida').slice(0, 120)}

REJEITE (adequada: false) se:
- for cena de filme, série, novela, ator famoso, entretenimento sem relação
- for stock genérico (igreja vazia, banco de imagens, wallpaper)
- for anime, cartoon, meme ou imagem totalmente desconectada do fato
- a pessoa/cena não corresponde ao assunto (ex.: homens de drama em matéria sobre pastora)
- a URL/título cita pastor/cantor FAMOSO (Silas Malafaia, Marcos Feliciano, Edir Macedo, Damares, Fernandinho, etc.) mas a matéria NÃO menciona essa pessoa pelo nome
- a matéria fala de pessoa anônima (ex-líder de gangue, nome não divulgado) e a imagem parece ser de celebridade gospel conhecida

APROVE somente se os metadados indicam forte relação com o fato ESPECÍFICO desta matéria.

JSON: {"adequada": true ou false, "motivo": "breve"}`;

  try {
    const resposta = await chatCompletion(
      [
        {
          role: 'system',
          content: 'Você valida capas jornalísticas. Seja rigoroso. Retorne somente JSON válido.'
        },
        { role: 'user', content: prompt }
      ],
      { json: true, temperature: 0.05, maxTokens: 200 }
    );

    const raw = typeof resposta === 'string' ? parsearJson(resposta) : resposta;
    return raw.adequada === true;
  } catch (e) {
    console.warn('validarImagemParaArtigo:', e.message);
    return false;
  }
}

async function selecionarMelhorImagem(artigo, candidatos, opcoes = {}) {
  if (!candidatos.length) return { candidato: null, rejeitouTodas: true };

  const { titulo, resumo, assuntoImagem, pessoaPrincipal, conteudo } = artigo;
  const { candidatosDaNoticia = false } = opcoes;

  if (candidatos.length === 1) {
    const ok = await validarImagemParaArtigo(artigo, candidatos[0]);
    return { candidato: ok ? candidatos[0] : null, rejeitouTodas: !ok };
  }

  const lista = candidatos.slice(0, 12).map((c, i) => {
    const pagina = (c.contextLink || c.source || '').replace(/^https?:\/\//, '').slice(0, 60);
    const origem = c.fromFonte ? ' [FONTE ORIGINAL]' : (c.fromNoticia ? ' [NOTÍCIA]' : '');
    return `${i}: "${(c.title || c.alt || 'sem título').slice(0, 100)}" | página: ${pagina || '?'}${origem}`;
  }).join('\n');

  const regraNoticia = candidatosDaNoticia
    ? `- PRIORIZE imagens [FONTE ORIGINAL] ou [NOTÍCIA] que correspondam ao título/assunto
- Rejeite (-1) se for logo, ícone, banner, filme/série ou matéria diferente`
    : `- Rejeite (-1) se NENHUMA ilustrar o fato: pessoa errada, stock genérico, filme/série, anime, tema gospel genérico
- A capa deve corresponder ao FATO específico desta matéria`;

  const prompt = `Escolha a imagem de capa MAIS ADEQUADA para esta matéria de portal gospel.

TÍTULO: ${titulo}
RESUMO: ${resumo}
FOTO IDEAL: ${assuntoImagem || 'cena relacionada ao fato da matéria'}
${pessoaPrincipal ? `PESSOA CENTRAL: ${pessoaPrincipal}` : ''}
${conteudo ? `CONTEXTO: ${textoPlano(conteudo).slice(0, 600)}` : ''}

CANDIDATAS:
${lista}

REGRAS:
- Retorne o índice (0 a ${Math.min(candidatos.length, 12) - 1}) da melhor imagem
- NUNCA escolha imagem de filme, série ou entretenimento sem relação com o fato
${regraNoticia}
- Se nenhuma servir, retorne indice -1

JSON: {"indice": N, "motivo": "breve explicação"}`;

  try {
    const resposta = await chatCompletion(
      [
        {
          role: 'system',
          content: 'Você seleciona capas jornalísticas. Seja rigoroso. Retorne somente JSON válido.'
        },
        { role: 'user', content: prompt }
      ],
      { json: true, temperature: 0.1, maxTokens: 300 }
    );

    const raw = typeof resposta === 'string' ? parsearJson(resposta) : resposta;
    const indice = parseInt(raw.indice, 10);
    if (Number.isNaN(indice) || indice < 0) {
      return { candidato: null, rejeitouTodas: true };
    }
    const candidato = candidatos[indice] || null;
    if (!candidato) return { candidato: null, rejeitouTodas: true };
    const ok = await validarImagemParaArtigo(artigo, candidato);
    return { candidato: ok ? candidato : null, rejeitouTodas: !ok };
  } catch (e) {
    console.warn('selecionarMelhorImagem:', e.message);
    const fallback = candidatos.find((c) => c.fromFonte || c.fromNoticia) || candidatos[0];
    return { candidato: fallback || null, rejeitouTodas: !fallback };
  }
}

async function gerarArtigo({
  tituloReferencia,
  resumoReferencia,
  fonte,
  nicho,
  nomeSite,
  contextoApuracao,
  fontesApuracao,
  dataReferencia,
  emAlta,
  redeSocial,
  conteudoInternacional,
  investigativa,
  palavrasChaveInvestigativa,
  formatoInvestigativa,
  nomesApurados,
  evidenciasVerificadas,
  correcaoInvestigativa
}) {
  const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const evidenciasLista = deduplicarEvidencias(evidenciasVerificadas);
  const listaFontes = (fontesApuracao || [])
    .map((f, i) => `${i + 1}. ${f.veiculo || 'Fonte'}: ${f.titulo || ''}${f.url ? ` (${f.url})` : ''}`)
    .join('\n');

  const contexto = contextoApuracao || [
    tituloReferencia ? `Manchete de referência (não copiar): ${tituloReferencia}` : null,
    resumoReferencia ? `Contexto inicial: ${resumoReferencia}` : null,
    fonte ? `Link de apuração: ${fonte}` : null,
    nicho ? `Editoria: ${nicho}` : null,
    dataReferencia ? `Data da referência: ${dataReferencia}` : null,
    emAlta ? 'Este assunto está em alta nos últimos dias.' : null
  ].filter(Boolean).join('\n');

  const prompt = `Você é repórter de portal de notícias gospel no Brasil. Estilo: G1/Globo — direto, humano, com furo no lead.
${investigativa ? `
MODO: MATÉRIA INVESTIGATIVA — cruzamento de múltiplas fontes (portais, notícias, web).
TEMA OBRIGATÓRIO DO USUÁRIO: ${palavrasChaveInvestigativa || tituloReferencia || nicho || 'conforme pauta'}
${formatoInvestigativa === 'listagem_nomes' ? `
FORMATO LISTAGEM ("quem são eles") — SOMENTE COM PROVA DOCUMENTAL:
- Lead: use o número EXATO de pessoas confirmadas abaixo (${evidenciasLista.length}). Nunca invente quantidade maior.
- Para CADA pessoa confirmada: um <h2> com o nome EXATO da lista + 1–2 <p> reescrevendo o fato do trecho + atribuição ao veículo/URL.
- PROIBIDO incluir qualquer pessoa que NÃO esteja na lista abaixo.
- PROIBIDO inferir divórcio de "primeira esposa" ou biografia genérica.
- Pode usar UM <h2>Contexto</h2> no final (seção genérica, sem nome de pessoa).
- Se só houver 1–2 casos confirmados, diga isso claramente — não encha a lista.
- Título: se houver ${evidenciasLista.length} nomes, manchete sobre A LISTA (ex.: "${evidenciasLista.length} líderes gospel com divórcio documentado") — NUNCA manchete focada em um único nome quando há vários confirmados.
${evidenciasLista.length
  ? `PESSOAS COM PROVA (${evidenciasLista.length}) — use estes nomes nos <h2>: ${evidenciasLista.map((e) => e.nome).join('; ')}`
  : 'NENHUMA PESSOA CONFIRMADA — escreva matéria explicando que a apuração não encontrou casos documentados com divórcio explícito em matérias lidas.'}
${correcaoInvestigativa ? `\nCORREÇÃO OBRIGATÓRIA: ${correcaoInvestigativa}` : ''}
` : `
NÃO escreva sobre outro assunto que não seja o tema acima.
Sintetize fatos das fontes relevantes com redação original. O lead deve revelar o furo principal SOBRE ESTE ASSUNTO.
`}
` : ''}

DATA: ${hoje} | SITE: ${nomeSite || 'Portal Gospel'}

PAUTA (base factual — reescreva, NÃO copie):
${contextoApuracao || contexto || 'Matéria original sobre tema atual do universo gospel/evangélico brasileiro.'}

${listaFontes ? `FONTES (atribua genericamente, sem inventar entrevistas):\n${listaFontes}` : ''}

${blocoRegrasEditoriais(nomeSite)}
${investigativa ? `
REGRAS INVESTIGATIVAS (OBRIGATÓRIO):
- Jornalismo verificável: cada fato sobre uma pessoa precisa estar nas EVIDÊNCIAS DOCUMENTAIS abaixo.
- ZERO invenção, ZERO inferência, ZERO "conhecimento geral" sobre biografias de pastores.
- Proibido afirmar divórcio sem trecho explícito de matéria/portal com URL.
- Não invente declarações, entrevistas nem quantidade de casos.
${formatoInvestigativa === 'listagem_nomes' ? '- Um <h2> por pessoa confirmada (nome exato da lista) + opcional <h2>Contexto</h2>. Nenhum outro nome em subtítulo.' : '- Valor editorial: cruzamento de fontes documentadas.'}
` : ''}

ESTRUTURA OBRIGATÓRIA DA MATÉRIA:
${formatoInvestigativa === 'listagem_nomes' ? `
1. LEAD (1º <p>): apresente a lista e quantos nomes foram confirmados nas fontes.
2. BLOCO POR PESSOA: <h2>Nome Exato Da Lista</h2> + 1–2 <p> com contexto factual (só nomes confirmados).
3. OPCIONAL: <h2>Contexto</h2> + 1–2 <p> sobre panorama geral (sem citar pessoas não confirmadas).
4. FECHAMENTO (1 <p> curto).
` : `
1. LEAD (1º <p>): o furo — o que aconteceu e por que o leitor deve se importar AGORA.
2. DESENVOLVIMENTO (3–4 <p>): fatos, contexto breve, repercussão na comunidade gospel.
3. <h2> + 1–2 <p>: detalhes ou desdobramento do caso.
4. <h2> + 1–2 <p>: impacto, reações ou próximos passos.
5. FECHAMENTO (1 <p> curto): síntese sem repetir o lead.
`}

REGRAS DE ESCRITA:
- ${IDEAL_MIN_PALAVRAS}–${IDEAL_MAX_PALAVRAS} palavras no corpo (nunca ultrapasse ${MAX_PALAVRAS_ARTIGO}).
- Frases variadas; zero tom de release ou robô.
- Valor único: o que sua redação acrescenta além de copiar a fonte.
- Sem citações inventadas entre aspas.
${redeSocial ? `- Pauta de rede social: use os FATOS da publicação (o que foi dito, anunciado, mostrado ou viralizou) e transforme em reportagem com furo. Atribua genericamente ("conforme postagem no Instagram", "em publicação que circulou nas redes"). Reescreva 100% com palavras próprias — NUNCA copie frases literais do post.` : ''}
${conteudoInternacional ? `
IDIOMA DA FONTE (IMPORTANTE):
- A pauta pode estar em inglês, espanhol ou outro idioma.
- Traduza os FATOS para português do Brasil com reescrita jornalística — NUNCA tradução literal nem cópia de parágrafos.
- Escreva para o leitor brasileiro: matéria original, com furo de reportagem, tom G1/Globo.
- Pode citar genericamente que o fato repercute no exterior ou em veículos internacionais, sem inventar declarações.
- Nomes próprios podem manter grafia original quando usual (ex.: Hillsong, Bethel).` : ''}

Retorne APENAS JSON válido:
{
  "titulo": "manchete com furo, máx 90 caracteres, sem clickbait",
  "resumo": "linha fina jornalística, máx 200 caracteres",
  "conteudo": "HTML: <p> e 2 <h2> — entre ${IDEAL_MIN_PALAVRAS} e ${IDEAL_MAX_PALAVRAS} palavras",
  "meta_title": "SEO máx 60 caracteres",
  "meta_description": "SEO máx 160 caracteres",
  "pessoa_principal": "nome completo se houver pessoa identificada, senão null",
  "assunto_imagem": "cena precisa da foto ideal; se anônimo, descreva o fato visualmente",
  "termos_imagem": "3 buscas separadas por vírgula"
}`;

  const systemMsg = investigativa
    ? 'Repórter investigativo gospel brasileiro. Fact-check rigoroso: só fatos com prova no trecho fornecido. Nunca use biografia de treinamento. JSON válido.'
    : conteudoInternacional
    ? 'Redator investigativo gospel brasileiro. Fontes podem estar em outro idioma: traduza fatos e reescreva em português do Brasil com furo de reportagem. E-E-A-T, original, sem plágio. Retorne somente JSON válido.'
    : 'Redator investigativo gospel brasileiro. Conteúdo people-first, E-E-A-T, original, com furo de reportagem. Reportagem a partir de fontes externas: sim. Plágio: nunca. Matérias ENXUTAS e densas, não longas. Retorne somente JSON válido.';

  const resposta = await chatCompletion(
    [
      { role: 'system', content: systemMsg },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: investigativa ? 0.45 : 0.78, maxTokens: 5000 }
  );

  let artigo = normalizarArtigo(resposta);
  let qualidade = avaliarComprimento(artigo.conteudo);

  if (qualidade.curto) {
    const expandPrompt = `Artigo CURTO (${qualidade.palavras} palavras). Complemente até ${IDEAL_MIN_PALAVRAS}–${IDEAL_MAX_PALAVRAS} palavras SEM repetir o lead nem encher linguiça. Mantenha os mesmos fatos.

${blocoRegrasEditoriais(nomeSite)}

ARTIGO:
${JSON.stringify({ titulo: artigo.titulo, resumo: artigo.resumo, conteudo: artigo.conteudo })}

Retorne JSON completo atualizado.`;

    try {
      const expandido = await chatCompletion(
        [{ role: 'system', content: systemMsg }, { role: 'user', content: expandPrompt }],
        { json: true, temperature: 0.7, maxTokens: 5000 }
      );
      artigo = normalizarArtigo(expandido);
      qualidade = avaliarComprimento(artigo.conteudo);
    } catch (e) {
      console.warn('Expandir artigo curto:', e.message);
    }
  }

  if (qualidade.longo) {
    const encurtarPrompt = `Artigo LONGO (${qualidade.palavras} palavras). Enxugue para ${IDEAL_MIN_PALAVRAS}–${IDEAL_MAX_PALAVRAS} palavras (máx ${MAX_PALAVRAS_ARTIGO}). Remova repetições e parágrafos genéricos. Mantenha o furo, os fatos e 2 <h2>.

ARTIGO:
${JSON.stringify({ titulo: artigo.titulo, resumo: artigo.resumo, conteudo: artigo.conteudo })}

Retorne JSON completo enxuto.`;

    try {
      const enxuto = await chatCompletion(
        [{ role: 'system', content: systemMsg }, { role: 'user', content: encurtarPrompt }],
        { json: true, temperature: 0.65, maxTokens: 4500 }
      );
      artigo = normalizarArtigo(enxuto);
      qualidade = avaliarComprimento(artigo.conteudo);
    } catch (e) {
      console.warn('Encurtar artigo longo:', e.message);
    }
  }

  artigo._palavras = qualidade.palavras;
  artigo._qualidadeOk = qualidade.ok;
  artigo._avisoQualidade = mensagemAvisoQualidade(qualidade);

  return artigo;
}

function parsearJson(texto) {
  if (!texto) throw new Error('A IA retornou um formato inválido. Tente novamente.');
  if (typeof texto === 'object') return texto;

  let limpo = String(texto).replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  const tentativas = [
    limpo,
    limpo.replace(/,\s*([}\]])/g, '$1'),
    limpo.match(/\{[\s\S]*\}/)?.[0],
    limpo.match(/\[[\s\S]*\]/)?.[0]
  ].filter(Boolean);

  for (const candidato of tentativas) {
    try {
      return JSON.parse(candidato);
    } catch {
      /* próxima tentativa */
    }
  }

  throw new Error('A IA retornou um formato inválido. Tente novamente.');
}

/**
 * Fact-check: confirma só evidências com divórcio/separação EXPLÍCITOS no trecho.
 */
async function filtrarEvidenciasInvestigativas(evidencias, tema) {
  if (!Array.isArray(evidencias) || !evidencias.length) return [];

  const lista = evidencias.slice(0, 20).map((e, i) =>
    `[${i + 1}] NOME: ${e.nome}\nURL: ${e.url}\nTRECHO: ${e.trecho}`
  ).join('\n\n');

  const prompt = `Você é fact-checker jornalístico. Tema: ${tema}

Analise cada evidência abaixo. CONFIRME apenas se o TRECHO afirma EXPLICITAMENTE que a pessoa passou por divórcio ou separação conjugal documentada.

REJEITE se:
- for só inferência ("primeira esposa", "casou novamente") sem palavra explícita de divórcio/separação no trecho
- o trecho não mencionar divórcio/separação do nome indicado
- parecer biografia genérica ou conhecimento de treinamento sem fato explícito no trecho

EVIDÊNCIAS:
${lista}

Retorne JSON:
{
  "confirmados": [
    { "nome": "...", "trecho": "...", "url": "...", "veiculo": "..." }
  ]
}`;

  const resposta = await chatCompletion(
    [
      { role: 'system', content: 'Fact-checker rigoroso. Zero inferência. Só confirma fatos explícitos no trecho. JSON válido.' },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: 0.1, maxTokens: 2000 }
  );

  const raw = parsearJson(resposta);
  const confirmados = Array.isArray(raw.confirmados) ? raw.confirmados : [];
  return confirmados
    .filter((c) => c?.nome && c?.trecho)
    .map((c) => ({
      nome: c.nome,
      trecho: c.trecho,
      url: c.url || evidencias.find((e) => e.nome === c.nome)?.url,
      veiculo: c.veiculo || evidencias.find((e) => e.nome === c.nome)?.veiculo,
      tituloFonte: evidencias.find((e) => e.nome === c.nome)?.tituloFonte
    }));
}

module.exports = {
  chatCompletion,
  gerarArtigo,
  parsearJson,
  normalizarArtigo,
  identificarCapaArtigo,
  selecionarMelhorImagem,
  validarImagemParaArtigo,
  gerarAltImagem,
  textoPlano,
  filtrarEvidenciasInvestigativas
};
