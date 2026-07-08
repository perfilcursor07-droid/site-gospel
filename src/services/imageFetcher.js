const fs = require('fs');
const path = require('path');
const { resolverUrlNoticia, extrairMetadadosArtigo, urlImagemInvalida } = require('./articleSource');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const USER_AGENT = 'Mozilla/5.0 (compatible; SiteGospelBot/1.0)';

const TERMOS_IMAGEM_REJEITADOS = [
  'flag', 'usa', 'american', 'united-states', 'us-flag', 'stars-and-stripes',
  'stock-photo', 'getty', 'shutterstock', 'istockphoto', 'dreamstime',
  'empty-church', 'church-interior', 'church-pew', 'wooden-pew', 'sanctuary-empty',
  '1x1', 'pixel', 'placeholder', 'default', 'no-image', 'noimage'
];

const STOPWORDS = new Set([
  'sobre', 'nova', 'novo', 'mais', 'como', 'para', 'pela', 'pelo', 'entre',
  'apos', 'após', 'show', 'noite', 'diz', 'que', 'com', 'uma', 'seu', 'sua',
  'chega', 'nunca', 'recusou', 'desafios', 'deus', 'regiao', 'região', 'nova'
]);

function urlImagemIrrelevante(url, entidades = []) {
  if (urlImagemInvalida(url)) return true;
  const lower = url.toLowerCase();
  if (TERMOS_IMAGEM_REJEITADOS.some((t) => lower.includes(t))) return true;

  if (entidades.length) {
    const temEntidade = entidades.some((e) => {
      const partes = e.toLowerCase().split(/\s+/).filter((p) => p.length > 3);
      return partes.some((p) => lower.includes(p));
    });
    if (!temEntidade && (lower.includes('church') || lower.includes('igreja') || lower.includes('pew'))) {
      return true;
    }
  }
  return false;
}

function limparNomeEntidade(nome) {
  return nome
    .replace(/\s+(?:diz|afirma|anuncia|chega|lança|lanca|participa|que|nunca|sempre)\b.*$/i, '')
    .replace(/^(?:de|da|do|dos|das|o|a)\s+/i, '')
    .trim();
}

function extrairEntidades(titulo, resumo, pessoaPrincipal) {
  const entidades = new Set();
  const texto = `${titulo || ''} ${resumo || ''} ${pessoaPrincipal || ''}`;

  const padroes = [
    /\b(?:pastor(?:a)?|bispo|apóstolo|apostolo|cantor(?:a)?|pregador(?:a)?|mission[aá]rio)\s+([A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+){0,2})/gi,
    /\b([A-ZÀ-Ú][\wà-ú]+\s+[A-ZÀ-Ú][\wà-ú]+)\s+(?:diz|afirma|anuncia|chega|lança|lanca|participa)\b/gi
  ];

  for (const padrao of padroes) {
    for (const match of texto.matchAll(padrao)) {
      const nome = limparNomeEntidade((match[1] || '').trim());
      if (nome.length > 4 && !/^(de|da|do)\s/i.test(nome)) entidades.add(nome);
    }
  }

  if (pessoaPrincipal) {
    const limpo = limparNomeEntidade(pessoaPrincipal.trim());
    if (limpo.length > 4) entidades.add(limpo);
  }

  return [...entidades];
}

function montarConsultasImagem({ termosImagem, assuntoImagem, titulo, resumo, nicho, pessoaPrincipal, entidades }) {
  const consultas = [];
  const add = (q) => {
    if (q && q.trim().length > 3) consultas.push(q.trim());
  };

  for (const entidade of entidades) {
    add(`${entidade} pastor gospel brasil`);
    add(`${entidade} pregando`);
    add(entidade);
  }

  if (pessoaPrincipal) {
    add(`${pessoaPrincipal} pastor evangelico`);
    add(pessoaPrincipal);
  }

  if (assuntoImagem) add(assuntoImagem);

  if (termosImagem) {
    termosImagem.split(/[,;]+/).forEach((t) => add(t.trim()));
  }

  if (titulo) {
    const palavras = titulo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length > 3 && !STOPWORDS.has(p.toLowerCase()));
    if (palavras.length >= 2) add(palavras.slice(0, 6).join(' '));
  }

  if (resumo) {
    const palavrasResumo = resumo.split(/\s+/).filter((p) => p.length > 4).slice(0, 5).join(' ');
    if (palavrasResumo) add(palavrasResumo);
  }

  if (nicho) add(`${nicho} gospel brasil evento`);

  return [...new Set(consultas)];
}

async function buscarOpenverse(termos, entidades) {
  const query = encodeURIComponent(termos);
  const url = `https://api.openverse.org/v1/images/?q=${query}&page_size=15&license_type=commercial,modification`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((img) => {
        const candidato = img.url || img.thumbnail;
        return candidato && !urlImagemIrrelevante(candidato, entidades) && (img.height || 400) >= 300;
      })
      .sort((a, b) => pontuarImagemStock(a, entidades) - pontuarImagemStock(b, entidades))
      .map((img) => img.url || img.thumbnail);
  } catch {
    return [];
  }
}

function pontuarImagemStock(img, entidades) {
  const texto = `${img.title || ''} ${img.url || ''} ${img.creator || ''}`.toLowerCase();
  let score = 0;
  for (const e of entidades) {
    for (const parte of e.toLowerCase().split(/\s+/)) {
      if (parte.length > 3 && texto.includes(parte)) score -= 10;
    }
  }
  if (texto.includes('brazil') || texto.includes('brasil')) score -= 2;
  if (texto.includes('pastor') || texto.includes('preaching') || texto.includes('worship')) score -= 1;
  return score;
}

async function buscarWikimedia(termos, entidades) {
  const query = encodeURIComponent(termos);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json&origin=*`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    const paginas = data.query?.pages;
    if (!paginas) return [];
    return Object.values(paginas)
      .map((p) => p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url)
      .filter((u) => u && !urlImagemIrrelevante(u, entidades));
  } catch {
    return [];
  }
}

async function buscarPexels(termos, entidades) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(termos)}&per_page=8&orientation=landscape`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos || [])
      .map((f) => ({ url: f.src?.large2x || f.src?.large, alt: f.alt }))
      .filter((f) => f.url && !urlImagemIrrelevante(f.url, entidades))
      .map((f) => f.url);
  } catch {
    return [];
  }
}

async function baixarImagem(urlOrigem, referer) {
  if (!urlOrigem) return null;
  try {
    const res = await fetch(urlOrigem, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: referer || ''
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow'
    });
    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 2500 || buffer.length > 6 * 1024 * 1024) return null;

    const ext = contentType.includes('png') ? '.png'
      : contentType.includes('webp') ? '.webp'
        : contentType.includes('gif') ? '.gif' : '.jpg';

    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const nome = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, nome), buffer);
    return `/uploads/${nome}`;
  } catch (e) {
    console.warn('baixarImagem falhou:', urlOrigem?.slice(0, 80), e.message);
    return null;
  }
}

async function tentarBaixarLista(urls, referer, entidades) {
  for (const url of urls) {
    if (!url || urlImagemIrrelevante(url, entidades)) continue;
    const salva = await baixarImagem(url, referer);
    if (salva) return salva;
  }
  return null;
}

async function buscarImagensStock(consultas, entidades) {
  for (const termos of consultas) {
    const urls = [
      ...(await buscarOpenverse(termos, entidades)),
      ...(await buscarPexels(termos, entidades)),
      ...(await buscarWikimedia(termos, entidades))
    ];
    const salva = await tentarBaixarLista(urls, null, entidades);
    if (salva) return salva;
  }
  return null;
}

async function obterImagensDaFonte(urlFonte, imagemFonte, imagensFonte, entidades) {
  const candidatos = [];
  const add = (u) => { if (u && !candidatos.includes(u)) candidatos.push(u); };

  if (imagemFonte) add(imagemFonte);
  if (Array.isArray(imagensFonte)) imagensFonte.forEach(add);

  if (urlFonte) {
    const meta = await extrairMetadadosArtigo(urlFonte);
    if (meta.imagens) meta.imagens.forEach(add);
    if (meta.imagem) add(meta.imagem);

    const filtrados = candidatos.filter((u) => !urlImagemIrrelevante(u, entidades));
    const salva = await tentarBaixarLista(filtrados.length ? filtrados : candidatos, meta.urlReal || urlFonte, entidades);
    if (salva) return salva;
  }

  return await tentarBaixarLista(candidatos, null, entidades);
}

async function obterImagemParaArtigo({
  termosImagem,
  assuntoImagem,
  pessoaPrincipal,
  titulo,
  resumo,
  nicho,
  urlFonte,
  imagemFonte,
  imagensFonte
}) {
  const entidades = extrairEntidades(titulo, resumo, pessoaPrincipal);

  const daFonte = await obterImagensDaFonte(urlFonte, imagemFonte, imagensFonte, entidades);
  if (daFonte) return daFonte;

  const consultas = montarConsultasImagem({
    termosImagem, assuntoImagem, titulo, resumo, nicho, pessoaPrincipal, entidades
  });

  const stock = await buscarImagensStock(consultas, entidades);
  if (stock) return stock;

  if (entidades.length) {
    const fallback = await buscarImagensStock(
      entidades.map((e) => `${e} culto evangelico brasil`),
      entidades
    );
    if (fallback) return fallback;
  }

  return null;
}

module.exports = { obterImagemParaArtigo, baixarImagem, extrairEntidades };
