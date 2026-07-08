const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

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

async function gerarArtigo({
  tituloReferencia,
  resumoReferencia,
  fonte,
  nicho,
  nomeSite,
  contextoApuracao,
  fontesApuracao,
  dataReferencia,
  emAlta
}) {
  const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
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

  const prompt = `Você é repórter de portal de notícias gospel no Brasil, com estilo editorial próximo ao jornalismo do g1/Globo: clareza, ritmo humano, apuração e responsabilidade.

DATA DE HOJE: ${hoje}

PAUTA E APURAÇÃO (use como base factual — NÃO plageie, NÃO copie frases):
${contexto || 'Crie uma matéria original sobre um tema relevante e atual do universo gospel/evangélico brasileiro.'}

${listaFontes ? `FONTES CONSULTADAS (cite de forma genérica, ex: "segundo relatos", "de acordo com informações divulgadas", sem inventar nomes de jornalistas):\n${listaFontes}` : ''}

REGRAS OBRIGATÓRIAS:
1. Texto 100% original em português do Brasil — reescreva com suas palavras.
2. Tom jornalístico humano: frases variadas, natural, sem parecer robô ou release.
3. Traga ângulo de reportagem: o que aconteceu, por que importa agora, contexto, repercussão e próximos passos.
4. Se houver furo ou novidade no assunto, destaque no lead (primeiro parágrafo).
5. Não invente citações entre aspas atribuídas a pessoas reais. Pode usar "segundo a assessoria", "de acordo com organizadores".
6. Mínimo 6 parágrafos substanciais + 2 subtítulos <h2>.
7. Pode usar <blockquote> para destaque de informação-chave (sem aspas falsas de entrevista).
8. Adequado ao público evangélico, mas com padrão de redação profissional de redação.

Retorne APENAS JSON válido:
{
  "titulo": "manchete forte, atual, máx 90 caracteres",
  "resumo": "linha fina / subtítulo jornalístico, máx 200 caracteres",
  "conteudo": "HTML com <p> e <h2>",
  "meta_title": "SEO máx 60 caracteres",
  "meta_description": "SEO máx 160 caracteres",
  "pessoa_principal": "nome completo da pessoa central da matéria, se houver (ex: Felipe Golim). Null se não houver pessoa específica.",
  "assunto_imagem": "descrição em português do que DEVE aparecer na foto de capa — seja específico (ex: Pastor Felipe Golim pregando em culto com público). Nunca sugira igreja vazia genérica.",
  "termos_imagem": "termos de busca em inglês e português para achar a foto certa, incluindo nome da pessoa se houver. Ex: Felipe Golim pastor, gospel preacher brazil crowd"
}`;

  const resposta = await chatCompletion(
    [
      {
        role: 'system',
        content: 'Você é redator investigativo brasileiro. Retorne somente JSON válido, sem markdown. Nunca plageie texto de fontes.'
      },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: 0.85, maxTokens: 6000 }
  );

  return normalizarArtigo(resposta);
}

function parsearJson(texto) {
  const limpo = texto.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('A IA retornou um formato inválido. Tente novamente.');
  }
}

module.exports = { chatCompletion, gerarArtigo, parsearJson, normalizarArtigo };
