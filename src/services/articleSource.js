const USER_AGENT = 'Mozilla/5.0 (compatible; SiteGospelBot/1.0; +https://gitlab.com/perfilcursor07-group/obuxixo)';
const { buscarContextoLlm } = require('./braveSearch');
const { braveDisponivel } = require('./braveApi');

const DOMINIOS_IMAGEM_REJEITADOS = [
  'news.google.com', 'google.com', 'googleusercontent.com', 'gstatic.com', 'ggpht.com',
  'favicon', 'logo', 'icon', 'sprite', 'placeholder', '1x1', 'pixel', 'avatar'
];

function urlImagemInvalida(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return DOMINIOS_IMAGEM_REJEITADOS.some((d) => lower.includes(d));
}

function decodificarHtml(texto) {
  if (!texto) return '';
  return texto
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairMeta(html, propriedade) {
  const padroes = [
    new RegExp(`<meta[^>]+property=["']${propriedade}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${propriedade}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${propriedade}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${propriedade}["']`, 'i')
  ];
  for (const re of padroes) {
    const m = html.match(re);
    if (m?.[1]) return decodificarHtml(m[1]);
  }
  return null;
}

async function resolverUrlNoticia(url) {
  if (!url) return null;
  if (!url.includes('news.google.com')) return url;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    });
    const html = await res.text();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1];
    if (canonical && !canonical.includes('news.google.com')) return canonical;
    if (res.url && !res.url.includes('news.google.com')) return res.url;

    const urlDecodificada = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*data-n-au=/i)?.[1]
      || html.match(/href=["'](https?:\/\/(?!news\.google)[^"']+)["']/i)?.[1];
    if (urlDecodificada && !urlDecodificada.includes('google.com')) return urlDecodificada;
  } catch (e) {
    console.warn('resolverUrlNoticia:', e.message);
  }
  return null;
}

async function extrairMetadadosArtigo(url) {
  const urlReal = await resolverUrlNoticia(url);
  if (!urlReal) return { urlReal: null, imagem: null, imagens: [], descricao: null, titulo: null, trecho: null };

  try {
    const res = await fetch(urlReal, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return { urlReal, imagem: null, imagens: [], descricao: null, titulo: null, trecho: null };

    const html = await res.text();
    const imagens = extrairImagensDoHtml(html, urlReal);
    const imagem = imagens[0] || null;
    const descricao = extrairMeta(html, 'og:description') || extrairMeta(html, 'description');
    const titulo = extrairMeta(html, 'og:title');

    let trecho = '';
    const paragrafos = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of paragrafos) {
      const texto = decodificarHtml(p);
      if (texto.length > 80) {
        trecho = texto.slice(0, 500);
        break;
      }
    }

    return { urlReal, imagem, imagens, descricao, titulo, trecho };
  } catch (e) {
    console.warn('extrairMetadadosArtigo:', e.message);
    return { urlReal, imagem: null, imagens: [], descricao: null, titulo: null, trecho: null };
  }
}

function extrairImagensDoHtml(html, baseUrl) {
  const candidatos = [];
  const vistos = new Set();

  const padroes = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
    /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi
  ];

  for (const padrao of padroes) {
    for (const match of html.matchAll(padrao)) {
      let url = match[1];
      if (!url || url.startsWith('data:')) continue;
      if (url.startsWith('//')) url = `https:${url}`;
      else if (url.startsWith('/')) {
        try { url = new URL(url, baseUrl).href; } catch { continue; }
      }
      if (urlImagemInvalida(url) || vistos.has(url)) continue;
      vistos.add(url);
      candidatos.push(url);
    }
  }

  return candidatos;
}

function ehTopicoRedeSocial(topico) {
  return topico.tipoFonte === 'rede_social' || !!topico.redeSocial;
}

function montarTextoPostRede(topico, titulo, resumo) {
  const chunks = [];
  if (topico.conteudoRede && topico.conteudoRede.length > 15) chunks.push(topico.conteudoRede);
  if (resumo && resumo.length > 15 && resumo !== titulo) chunks.push(resumo);
  if (titulo && titulo.length > 15) chunks.push(titulo);
  return chunks.join(' — ').slice(0, 900);
}

async function apurarTopico(topico) {
  const tituloLimpo = decodificarHtml(topico.titulo || '')
    .replace(/\s*[-–—|]\s*[^-|–—]{2,60}$/u, '')
    .trim();
  const resumoLimpo = decodificarHtml(topico.resumo || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/news\.google\.com[^\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ehTopicoRedeSocial(topico) ? 600 : 400);

  const base = {
    ...topico,
    titulo: tituloLimpo,
    resumo: resumoLimpo,
    veiculo: topico.redeSocial || extrairVeiculo(tituloLimpo),
    redeSocial: topico.redeSocial || (ehTopicoRedeSocial(topico) ? detectarRedeDaUrl(topico.link) : null)
  };

  const fontesApuracao = [];

  if (ehTopicoRedeSocial(topico)) {
    const textoPost = montarTextoPostRede(topico, tituloLimpo, resumoLimpo);
    if (textoPost.length > 40) {
      fontesApuracao.push({
        veiculo: base.redeSocial || 'Rede social',
        url: topico.link,
        titulo: tituloLimpo,
        resumo: resumoLimpo,
        trecho: textoPost,
        ehRedeSocial: true
      });
    }
  }

  if (!topico.link) {
    return {
      ...base,
      contextoApuracao: fontesApuracao.length
        ? montarContextoApuracao(fontesApuracao, base)
        : undefined,
      fontesApuracao,
      dataReferencia: topico.data || new Date().toISOString()
    };
  }

  const meta = await extrairMetadadosArtigo(topico.link);

  if (meta.titulo || meta.descricao || meta.trecho) {
    fontesApuracao.push({
      veiculo: base.veiculo || 'Fonte consultada',
      url: meta.urlReal,
      titulo: meta.titulo || tituloLimpo,
      resumo: meta.descricao || resumoLimpo,
      trecho: meta.trecho || (ehTopicoRedeSocial(topico) ? meta.descricao : null),
      ehRedeSocial: ehTopicoRedeSocial(topico)
    });
  }

  if (braveDisponivel()) {
    try {
      const consultaContexto = [tituloLimpo, resumoLimpo, topico.conteudoRede, meta.titulo, meta.descricao]
        .filter(Boolean)
        .join(' ')
        .slice(0, 220);
      const consultaBrave = topico.fonteInternacional
        ? `${consultaContexto} christian gospel news`
        : ehTopicoRedeSocial(topico)
          ? `${consultaContexto} gospel brasil repercussão redes sociais`
          : `${consultaContexto} gospel brasil`;
      const contextoBrave = await buscarContextoLlm(consultaBrave);
      if (contextoBrave && contextoBrave.length > 80) {
        fontesApuracao.push({
          veiculo: ehTopicoRedeSocial(topico) ? 'Apuração web (contexto)' : 'Apuração web (Brave)',
          url: meta.urlReal || topico.link,
          titulo: tituloLimpo,
          resumo: resumoLimpo,
          trecho: contextoBrave.slice(0, 1500),
          ehRedeSocial: ehTopicoRedeSocial(topico)
        });
      }
    } catch (e) {
      console.warn('buscarContextoLlm:', e.message);
    }
  }

  return {
    ...base,
    linkOriginal: topico.link,
    link: meta.urlReal || topico.link,
    imagemFonte: meta.imagem,
    imagensFonte: meta.imagens || [],
    contextoApuracao: montarContextoApuracao(fontesApuracao, base),
    fontesApuracao,
    dataReferencia: topico.data || new Date().toISOString()
  };
}

function detectarRedeDaUrl(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.com')) return 'Facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
  if (lower.includes('threads.net')) return 'Threads';
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('youtube.com')) return 'YouTube';
  return null;
}

function extrairVeiculo(titulo) {
  const partes = titulo.split(' - ');
  if (partes.length > 1) return partes[partes.length - 1].trim();
  return null;
}

function montarContextoApuracao(fontes, topico) {
  const linhas = [
    `Assunto em pauta: ${topico.titulo}`,
    topico.resumo ? `Contexto inicial: ${topico.resumo}` : null,
    topico.redeSocial ? `Origem: publicação em ${topico.redeSocial}` : null,
    topico.data ? `Data da notícia de referência: ${topico.data}` : null
  ];

  fontes.forEach((f, i) => {
    linhas.push(`\nFonte ${i + 1} (${f.veiculo || 'veículo'}): ${f.titulo || ''}`);
    if (f.resumo) linhas.push(`Resumo da fonte: ${f.resumo}`);
    if (f.trecho && f.ehRedeSocial) {
      linhas.push(`Conteúdo da publicação (extraia os fatos e reescreva — NÃO copie frases): ${f.trecho}`);
    } else if (f.trecho) {
      linhas.push(`Trecho para apuração (NÃO copiar literalmente): ${f.trecho}`);
    }
    if (f.url) linhas.push(`URL: ${f.url}`);
  });

  return linhas.filter(Boolean).join('\n');
}

module.exports = {
  apurarTopico,
  resolverUrlNoticia,
  extrairMetadadosArtigo,
  extrairImagensDoHtml,
  decodificarHtml,
  urlImagemInvalida
};
