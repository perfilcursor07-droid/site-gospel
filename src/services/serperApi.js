/**
 * Cliente Serper com detecção do plano gratuito (sem operador site:).
 */
let bloqueioConsultaAvancada = false;
let avisoConsultaAvancada = false;

function serperDisponivel() {
  return !!process.env.SERPER_API_KEY;
}

function serperPermiteConsultasAvancadas() {
  return serperDisponivel() && !bloqueioConsultaAvancada;
}

function consultaUsaOperadorAvancado(query) {
  return /\bsite:/i.test(query || '');
}

function registrarRespostaSerper(res, corpoTexto = '') {
  const texto = String(corpoTexto || '');
  if (res?.status === 400 && /query pattern not allowed/i.test(texto)) {
    bloqueioConsultaAvancada = true;
    if (!avisoConsultaAvancada) {
      avisoConsultaAvancada = true;
      console.warn(
        'Serper (plano gratuito): consultas com site: não são permitidas. '
        + 'Usando buscas simplificadas. Para site:instagram.com etc., faça upgrade em serper.dev.'
      );
    }
    return true;
  }
  return false;
}

async function serperPost(endpoint, body, { timeoutMs = 14000 } = {}) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { ok: false, data: null, bloqueado: false };

  const query = body?.q || '';
  if (consultaUsaOperadorAvancado(query) && !serperPermiteConsultasAvancadas()) {
    return { ok: false, data: null, bloqueado: true, ignorado: true };
  }

  try {
    const res = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const texto = await res.text();
      const bloqueado = registrarRespostaSerper(res, texto);
      return { ok: false, data: null, bloqueado, status: res.status, texto };
    }

    const data = await res.json();
    return { ok: true, data, bloqueado: false };
  } catch (e) {
    return { ok: false, data: null, bloqueado: false, erro: e.message };
  }
}

function montarConsultasSerperRedesGratis(palavraChave) {
  const termo = palavraChave.trim();
  const termoGospel = `${termo} gospel brasil`;
  return [
    { q: `${termoGospel} instagram`, rede: 'Instagram', limite: 15 },
    { q: `${termoGospel} instagram reel`, rede: 'Instagram', limite: 12 },
    { q: `${termoGospel} facebook`, rede: 'Facebook', limite: 12 },
    { q: `${termoGospel} facebook post`, rede: 'Facebook', limite: 10 },
    { q: `${termoGospel} twitter OR x.com`, rede: 'X (Twitter)', limite: 12 },
    { q: `${termoGospel} tiktok`, rede: 'TikTok', limite: 10 },
    { q: `${termoGospel} youtube`, rede: 'YouTube', limite: 10 }
  ];
}

module.exports = {
  serperDisponivel,
  serperPermiteConsultasAvancadas,
  consultaUsaOperadorAvancado,
  registrarRespostaSerper,
  serperPost,
  montarConsultasSerperRedesGratis
};
