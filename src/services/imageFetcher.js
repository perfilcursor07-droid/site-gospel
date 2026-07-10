const fs = require('fs');
const path = require('path');
const { extrairMetadadosArtigo, urlImagemInvalida } = require('./articleSource');
const { identificarCapaArtigo, selecionarMelhorImagem, gerarAltImagem, validarImagemParaArtigo } = require('./deepseek');
const { salvarComoWebp } = require('../utils/imageProcessor');
const { buscarImagemPython, listarImagensPython, baixarImagemUrlPython } = require('./pythonImageSearch');
const { marcarRespostaBrave, marcarRespostaBraveOk, braveDisponivel, braveQuotaExcedida } = require('./braveApi');
const { serperPost, serperDisponivel, serperPermiteConsultasAvancadas } = require('./serperApi');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const USER_AGENT = 'Mozilla/5.0 (compatible; SiteGospelBot/1.0)';
const USER_AGENT_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const TERMOS_IMAGEM_REJEITADOS = [
  'flag', 'usa', 'american', 'united-states', 'us-flag', 'stars-and-stripes',
  'stock-photo', 'getty', 'shutterstock', 'istockphoto', 'dreamstime',
  'empty-church', 'church-interior', 'church-pew', 'wooden-pew', 'sanctuary-empty',
  '1x1', 'pixel', 'placeholder', 'default', 'no-image', 'noimage',
  'crunchyroll', 'anime', 'manga', 'cartoon', 'naruto', 'wallpaper', 'wallpapers',
  'pixiv', 'deviantart', 'hentai', 'funimation', 'disney-plus', 'netflix',
  'peaky', 'blinders', 'cillian', 'murphy', 'imdb', 'tmdb', 'still-frame',
  'movie-still', 'tv-series', 'serie-tv', 'fanart', 'fan-art', 'tumblr',
  'reddit.com/r/', 'wallhaven', 'artstation', 'behance', 'unsplash.com',
  'actors', 'actor', 'atores', 'celebrity', 'celebridade', 'hollywood'
];

const DOMINIOS_IMAGEM_REJEITADOS = [
  'crunchyroll.com', 'pixiv.net', 'deviantart.com', 'pinterest.com',
  'wallpaper', 'wallpapers.com', 'zerochan.net', 'anilist.co', 'myanimelist.net',
  'imdb.com', 'tmdb.org', 'reddit.com', 'tumblr.com', 'wallhaven.cc',
  'artstation.com', 'unsplash.com', 'pexels.com'
];

const STOPWORDS = new Set([
  'sobre', 'nova', 'novo', 'mais', 'como', 'para', 'pela', 'pelo', 'entre',
  'apos', 'após', 'show', 'noite', 'diz', 'que', 'com', 'uma', 'seu', 'sua',
  'chega', 'nunca', 'recusou', 'desafios', 'deus', 'regiao', 'região',
  'rebate', 'criticas', 'críticas', 'haters', 'louvo', 'estar', 'meio'
]);

const PALAVRAS_NAO_NOME = new Set([
  'lesbica', 'lésbica', 'gay', 'lgbt', 'trans', 'rebate', 'criticas', 'críticas',
  'haters', 'gospel', 'louvor', 'culto', 'igreja', 'brasil', 'sao', 'paulo',
  'nova', 'novo', 'em', 'de', 'da', 'do', 'na', 'no', 'por', 'com', 'sem'
]);

const IMAGEM_GENERICA = ['church', 'igreja', 'pew', 'chapel', 'cathedral', 'sanctuary', 'altar'];

/** Pastores/cantores muito famosos — rejeitar na capa se a matéria não os cita */
const FAMOSOS_GOSPEL = [
  'silas malafaia', 'marcos feliciano', 'edir macedo', 'valdemiro santiago',
  'rr soares', 'r r soares', 'evandro guedes', 'damares alves', 'fernandinho',
  'priscilla alcantara', 'priscila alcantara', 'bispo macedo', 'marcelo crivella',
  'romildo ribeiro', 'deive leonardo', 'lucas hoffmann', 'ana paula valadao',
  'soraya barbosa', 'casso saulo', 'cassiane', 'regis danese'
];

const SOBRENOMES_FAMOSOS = ['malafaia', 'feliciano', 'valdemiro', 'macedo', 'damares'];

function textoMateriaCompleto(ctx) {
  return normalizarTexto(
    `${ctx.titulo || ''} ${ctx.resumo || ''} ${ctx.tituloReferencia || ''} ${ctx.assuntoImagem || ''} ${ctx.conteudo || ''}`
  );
}

function materiaComPessoaAnonima(ctx) {
  const t = textoMateriaCompleto(ctx);
  return /\b(nome nao divulgado|nao teve o nome|nao foi identificado|identidade preservada|ex lider|ex criminoso|ex traficante|homem nao identificado|anonimo|sem revelar|nao teve nome|desconhecido)\b/.test(t)
    || /\b(lider de gangue|facao criminosa|faccao criminosa|gangue|trafico)\b/.test(t);
}

function famosoCitadoNaMateria(famoso, ctx) {
  const materia = textoMateriaCompleto(ctx);
  const partes = normalizarTexto(famoso).split(/\s+/).filter((p) => p.length > 2);
  if (partes.length >= 2) {
    return materia.includes(partes[0]) && materia.includes(partes[partes.length - 1]);
  }
  return partes.length === 1 && materia.includes(partes[0]);
}

function detectarFamosoImagem(img) {
  const texto = normalizarTexto(`${img.title || ''} ${img.url || ''} ${img.alt || ''} ${img.contextLink || ''}`);
  for (const famoso of FAMOSOS_GOSPEL) {
    const norm = normalizarTexto(famoso);
    const compacto = norm.replace(/\s+/g, '');
    if (texto.includes(norm) || texto.includes(norm.replace(/\s+/g, '-')) || texto.includes(compacto)) {
      return famoso;
    }
  }
  for (const sobrenome of SOBRENOMES_FAMOSOS) {
    if (texto.includes(sobrenome)) return sobrenome;
  }
  return null;
}

function imagemPessoaInadequada(img, ctx) {
  const famoso = detectarFamosoImagem(img);
  if (famoso) return !famosoCitadoNaMateria(famoso, ctx);

  if (materiaComPessoaAnonima(ctx)) {
    const texto = normalizarTexto(`${img.title || ''} ${img.url || ''} ${img.alt || ''}`);
    if (SOBRENOMES_FAMOSOS.some((s) => texto.includes(s))) return true;
  }
  return false;
}

function textoPlano(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizarTexto(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_+./%]/g, ' ')
    .toLowerCase();
}

function limparNomeEntidade(nome) {
  return nome
    .replace(/\s+(?:diz|afirma|anuncia|chega|lança|lanca|participa|rebate|que|nunca|sempre)\b.*$/i, '')
    .replace(/^(?:de|da|do|dos|das|o|a)\s+/i, '')
    .trim();
}

function pareceNomeProprio(nome) {
  const partes = nome.split(/\s+/).filter(Boolean);
  if (!partes.length || partes.length > 4) return false;

  const invalidas = partes.filter((p) => PALAVRAS_NAO_NOME.has(normalizarTexto(p)));
  if (invalidas.length) return false;

  const comMaiuscula = partes.filter((p) => /^[A-ZÀ-Ú]/.test(p) && /[a-zà-ú]/.test(p));
  return comMaiuscula.length >= Math.min(2, partes.length);
}

function extrairEntidades(titulo, resumo, pessoaPrincipal) {
  const entidades = new Set();
  const texto = `${titulo || ''} ${resumo || ''}`;

  const padroes = [
    /\b(?:pastor(?:a)?|bispo|apóstolo|apostolo|cantor(?:a)?|pregador(?:a)?|mission[aá]rio)\s+([A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+){0,2})/g,
    /\b([A-ZÀ-Ú][\wà-ú]+\s+[A-ZÀ-Ú][\wà-ú]+)\s+(?:diz|afirma|anuncia|chega|lança|lanca|participa|rebate)\b/g
  ];

  for (const padrao of padroes) {
    for (const match of texto.matchAll(padrao)) {
      const nome = limparNomeEntidade((match[1] || '').trim());
      if (nome.length > 4 && pareceNomeProprio(nome)) entidades.add(nome);
    }
  }

  if (pessoaPrincipal) {
    const limpo = limparNomeEntidade(pessoaPrincipal.trim());
    if (limpo.length > 4 && pareceNomeProprio(limpo)) entidades.add(limpo);
  }

  return [...entidades];
}

function extrairOrganizacoes(titulo, resumo) {
  const texto = `${titulo || ''} ${resumo || ''}`;
  const orgs = new Set();

  const padroes = [
    /\b((?:Igreja|Ministério|Ministerio|Comunidade|Aliança|Alianca|Projeto|Congregação|Congregacao|Missão|Missao|Aliança)\s+(?:em\s+|de\s+|da\s+|do\s+)?[A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+){0,3})/gi,
    /\b([A-ZÀ-Ú][\wà-ú]+\s+em\s+[A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+)?)/g
  ];

  for (const padrao of padroes) {
    for (const m of texto.matchAll(padrao)) {
      const nome = (m[1] || '').trim();
      if (nome.length > 6 && nome.length < 55) orgs.add(nome);
    }
  }

  for (const m of texto.matchAll(/\b([A-ZÀ-Ú][a-zà-ú]{2,}[A-Z][\wà-ú]*)\b/g)) {
    orgs.add(m[1]);
  }

  for (const m of texto.matchAll(/\bem\s+([A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+)?)\b/g)) {
    const local = m[1].trim();
    const primeira = local.split(/\s+/)[0];
    if (local.length > 4 && !['Cristo', 'Deus', 'Jesus', 'Brasil', 'Gospel'].includes(primeira)) {
      orgs.add(local);
    }
  }

  return [...orgs];
}

function imagemPareceLixoManual(img) {
  const url = (img.url || '').toLowerCase();
  const titulo = normalizarTexto(img.title || img.alt || '');
  const pagina = normalizarTexto(img.contextLink || img.source || '');

  if (/scontent\.|fbcdn\.net|facebook\.com|instagram\.com/.test(url)) {
    if (/\d{8,}[_/]\d+/.test(url) || /_\d+_\d+_\d+_n/.test(url)) return true;
  }

  if (/\b(slider|banner|carousel|carrossel|copiar|widget|thumb|logo|icone|icon|favicon|placeholder|sprite)\b/.test(titulo)) return true;
  if (/\b(slider|banner|carousel|carrossel|dedicação|dedicacao)\b/.test(pagina) && !titulo) return true;
  if (/^\d[\d_]+n?$/.test(titulo.replace(/\s/g, ''))) return true;
  if (titulo.length > 0 && titulo.length < 5 && !/[a-z]{3,}/.test(titulo)) return true;

  return false;
}

function imagemCombinaMateriaManual(img, ctx, { focoPessoa = [] } = {}) {
  if (!img?.url || urlImagemProibida(img.url, img.contextLink)) return false;

  if (focoPessoa.length) {
    return imagemMencionaPessoa(img, focoPessoa);
  }

  if (img.fromNoticia && paginaCombinaMateria(img, ctx.titulo, ctx.resumo, ctx.tituloReferencia)) {
    return true;
  }

  if (ctx.entidades.length && imagemCombinaAlgumaEntidade(img, ctx.entidades)) {
    return true;
  }

  return imagemCombinaMateria(img, { ...ctx, entidades: [] }, { ignorarOrigem: true });
}

function decodificarHtmlEntidades(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—');
}

function variantesNomePessoa(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return [nome].filter(Boolean);

  const variantes = new Set([partes.join(' ')]);
  const primeiro = partes[0];
  if (primeiro.length > 4) {
    variantes.add([primeiro.replace(/ian$/i, 'iam'), ...partes.slice(1)].join(' '));
    variantes.add([primeiro.replace(/iam$/i, 'ian'), ...partes.slice(1)].join(' '));
  }
  return [...variantes];
}

function extrairPessoaDosTermos(termos, titulo) {
  // Busca manual: priorizar só o que o usuário digitou (não misturar título da matéria)
  const fontes = [];
  if (termos && String(termos).trim()) fontes.push(String(termos).trim());
  else if (titulo && String(titulo).trim()) fontes.push(String(titulo).trim());

  const pessoas = new Set();
  const padraoProfissao = /\b(?:o\s+|a\s+)?(?:cantor(?:a)?|pastor(?:a)?|pregador(?:a)?|bispo|apóstolo|apostolo)\s+([A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+)?)/gi;

  for (const texto of fontes) {
    for (const m of texto.matchAll(padraoProfissao)) {
      const nome = limparNomeEntidade((m[1] || '').trim());
      if (nome.length > 4 && pareceNomeProprio(nome)) pessoas.add(nome);
    }

    const limpo = texto
      .replace(/^(?:a\s+|o\s+)?(?:cantor(?:a)?|pastor(?:a)?|pregador(?:a)?|bispo)\s+/i, '')
      .trim();

    const partes = limpo.split(/\s+/).filter(Boolean);
    if (partes.length >= 2 && partes.length <= 4) {
      const nomeCurto = partes
        .slice(0, 2)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
      if (pareceNomeProprio(nomeCurto)) pessoas.add(nomeCurto);

      if (partes.length > 2) {
        const nomeLongo = partes
          .slice(0, 3)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(' ');
        if (pareceNomeProprio(nomeLongo)) pessoas.add(nomeLongo);
      }
    }
  }

  return [...pessoas];
}

function montarConsultasPessoaFoco(nome) {
  const aspas = `"${nome}"`;
  const consultas = [
    `${aspas} cantora gospel foto`,
    `${aspas} cantora evangelica`,
    `${nome} gospel louvor foto`,
    `${nome} cantora`,
    `${nome} foto`,
    `${nome} cantora gospel show`,
    `site:instagram.com ${nome} gospel`,
    `site:instagram.com ${nome} cantora`,
    `site:youtube.com ${nome} cantora gospel`,
    `${nome} show culto igreja`
  ];
  if (!serperPermiteConsultasAvancadas()) {
    return consultas.filter((q) => !/\bsite:/i.test(q));
  }
  return consultas;
}

function imagemMencionaPessoa(img, pessoas) {
  if (!pessoas?.length) return true;
  const texto = textoImagem(img);
  return pessoas.some((p) =>
    variantesNomePessoa(p).some((variante) => imagemCombinaEntidade(texto, variante))
  );
}

function passaFiltroManual(img, ctx, { focoPessoa = [] } = {}) {
  if (!passaFiltroBasico(img)) return false;
  if (imagemPareceLixoManual(img)) return false;
  if (imagemPessoaInadequada(img, ctx)) return false;
  if (imagemUrlGenerica(img.url)) return false;

  if (focoPessoa.length && !imagemMencionaPessoa(img, focoPessoa)) {
    return false;
  }

  if (imagemCombinaMateriaManual(img, ctx, { focoPessoa })) return true;

  if (focoPessoa.length) return false;

  return pontuarImagemStock(img, ctx) <= 5;
}

function montarConsultasCapaManual({ titulo, resumo, assuntoImagem, entidades, organizacoes }) {
  const consultas = [];
  const add = (q) => { if (q && String(q).trim().length > 5) consultas.push(String(q).trim()); };

  if (titulo) {
    add(`"${titulo.slice(0, 90)}"`);
    add(`${titulo.slice(0, 70)} foto`);
  }

  for (const org of (organizacoes || []).slice(0, 3)) {
    add(`"${org}" igreja gospel foto`);
    add(`${org} culto evento`);
  }

  for (const ent of (entidades || []).slice(0, 2)) {
    add(`${ent} gospel foto`);
  }

  montarConsultasNoticia({ tituloReferencia: titulo, titulo, resumo, entidades: [...entidades, ...organizacoes] })
    .forEach(add);

  montarConsultasContextuais(titulo, resumo, assuntoImagem, entidades).forEach(add);

  return [...new Set(consultas)];
}

function extrairPalavrasChaveRelevancia(titulo, resumo, assuntoImagem, termosImagem) {
  const texto = `${titulo || ''} ${resumo || ''} ${assuntoImagem || ''} ${termosImagem || ''}`;
  const palavras = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 3 && !STOPWORDS.has(p));

  return [...new Set(palavras)];
}

function partesNome(entidade) {
  return normalizarTexto(entidade).split(/\s+/).filter((p) => p.length > 2);
}

function imagemCombinaEntidade(texto, entidade) {
  if (!texto || !entidade) return false;
  const norm = normalizarTexto(texto);
  const partes = partesNome(entidade);
  if (!partes.length) return false;
  if (partes.length === 1) return norm.includes(partes[0]);

  const sobrenome = partes[partes.length - 1];
  const primeiro = partes[0];
  if (norm.includes(sobrenome) && norm.includes(primeiro)) return true;

  const compacto = norm.replace(/\s+/g, '');
  const nomeCompacto = partes.join('');
  if (nomeCompacto.length > 6 && compacto.includes(nomeCompacto)) return true;

  return variantesNomePessoa(entidade).some((variante) => {
    const vPartes = partesNome(variante);
    if (vPartes.length < 2) return false;
    return norm.includes(vPartes[vPartes.length - 1]) && norm.includes(vPartes[0]);
  });
}

function imagemCombinaAlgumaEntidade(img, entidades) {
  if (!entidades.length) return true;
  const texto = `${img.title || ''} ${img.url || ''} ${img.alt || ''} ${img.contextLink || ''}`;
  return entidades.some((e) => imagemCombinaEntidade(texto, e));
}

function montarConsultasPessoa(entidade) {
  const nome = entidade.trim();
  return [
    `${nome} pastor`,
    `${nome} pastor gospel`,
    `${nome} culto evangelico`,
    `${nome} gospel`,
    `"${nome}"`
  ];
}
function montarConsultasContextuais(titulo, resumo, assuntoImagem, entidades = []) {
  if (entidades.length) return [];

  const ctx = normalizarTexto(`${titulo} ${resumo} ${assuntoImagem}`);
  const consultas = [];

  // Matérias sobre crime/conversão anônima: buscar o fato, não pastor famoso genérico
  if (/gangue|facao|faccao|criminoso|trafico|soterrados|deslizamento|profecia|rende|rendeu/.test(ctx)) {
    if (titulo && titulo.length > 20) {
      consultas.push(`"${titulo.slice(0, 90)}"`);
      const palavras = titulo
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((p) => p.length > 4 && !STOPWORDS.has(p.toLowerCase()))
        .slice(0, 5);
      if (palavras.length >= 2) consultas.push(`${palavras.join(' ')} noticia`);
    }
    return consultas;
  }

  // Matérias com manchete específica: buscar a notícia, não stock genérico
  if (titulo && titulo.length > 25) {
    consultas.push(`"${titulo.slice(0, 90)}"`);
    const palavras = titulo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length > 4 && !STOPWORDS.has(p.toLowerCase()))
      .slice(0, 5);
    if (palavras.length >= 2) consultas.push(`${palavras.join(' ')} noticia foto`);
    return consultas;
  }

  if (/cantor|cantora|music|show|artista/.test(ctx)) {
    consultas.push('cantora gospel culto microfone brasil');
  }
  if (/congresso|evento|conferencia|conferência/.test(ctx)) {
    consultas.push('gospel conference audience brazil');
  }

  return consultas;
}

function extrairTermosMateria(titulo, resumo, tituloReferencia) {
  const texto = `${titulo || ''} ${resumo || ''} ${tituloReferencia || ''}`;
  const termos = new Set();

  for (const match of texto.matchAll(/\b(\d{2,4})\b/g)) termos.add(match[1]);

  for (const match of texto.matchAll(/\b([A-ZÀ-Ú][\wà-ú]*(?:ão|zão|zinha)?|\b[A-ZÀ-Ú][\wà-ú]+(?:\s+[A-ZÀ-Ú][\wà-ú]+){0,2})/g)) {
    const t = normalizarTexto(match[1]);
    if (t.length > 3 && !STOPWORDS.has(t)) termos.add(t);
  }

  extrairPalavrasChaveRelevancia(titulo, resumo, '', '').forEach((p) => termos.add(p));

  return [...termos].filter(Boolean);
}

function textoImagem(img) {
  return normalizarTexto(`${img.title || ''} ${img.url || ''} ${img.alt || ''} ${img.contextLink || ''}`);
}

function urlImagemProibida(url, contextLink = '') {
  const norm = normalizarTexto(`${url || ''} ${contextLink || ''}`);
  if (DOMINIOS_IMAGEM_REJEITADOS.some((d) => norm.includes(normalizarTexto(d)))) return true;
  return TERMOS_IMAGEM_REJEITADOS.some((t) => norm.includes(t));
}

function extrairPalavrasMateria(titulo, resumo, tituloReferencia) {
  const texto = normalizarTexto(`${titulo || ''} ${resumo || ''} ${tituloReferencia || ''}`);
  return texto
    .split(/\s+/)
    .filter((p) => p.length > 3 && !STOPWORDS.has(p));
}

function paginaCombinaMateria(img, titulo, resumo, tituloReferencia) {
  const pagina = normalizarTexto(`${img.contextLink || img.source || ''} ${img.title || ''} ${img.alt || ''}`);
  if (!pagina || pagina.length < 8) return false;

  const palavras = [...new Set(extrairPalavrasMateria(titulo, resumo, tituloReferencia))];
  if (!palavras.length) return false;

  const fortes = palavras.filter((p) => p.length > 5 || /^\d+$/.test(p));
  const acertos = palavras.filter((p) => pagina.includes(p));
  const acertosFortes = fortes.filter((p) => pagina.includes(p));

  if (acertosFortes.length >= 1 && acertos.length >= 2) return true;
  if (acertos.length >= Math.min(3, Math.max(2, Math.ceil(palavras.length * 0.35)))) return true;

  return false;
}

function imagemCombinaMateria(img, ctx, { ignorarOrigem = false } = {}) {
  if (!img?.url || urlImagemProibida(img.url, img.contextLink)) return false;

  const texto = textoImagem(img);

  if (ctx.entidades.length) {
    return imagemCombinaAlgumaEntidade(img, ctx.entidades);
  }

  if (!ignorarOrigem && (img.fromFonte || img.fromNoticia)) {
    if (paginaCombinaMateria(img, ctx.titulo, ctx.resumo, ctx.tituloReferencia)) {
      return passaFiltroBasico(img) && !imagemUrlGenerica(img.url);
    }
    return imagemCombinaMateria(img, ctx, { ignorarOrigem: true });
  }

  const termos = ctx.termosMateria || [];
  if (!termos.length) return textoCombinaContexto(texto, ctx);

  const acertos = termos.filter((t) => t.length > 2 && texto.includes(normalizarTexto(t)));
  const fortes = termos.filter((t) => t.length > 4 || /^\d+$/.test(t));
  const acertosFortes = fortes.filter((t) => texto.includes(normalizarTexto(t)));

  if (acertosFortes.length >= 1 && acertos.length >= 2) return true;
  if (acertos.length >= Math.min(3, Math.max(2, termos.length))) return true;

  return false;
}

function criarContextoRelevancia({ titulo, resumo, assuntoImagem, termosImagem, pessoaPrincipal, entidades, briefing, tituloReferencia }) {
  const palavrasChave = extrairPalavrasChaveRelevancia(titulo, resumo, assuntoImagem, termosImagem);
  const termosMateria = extrairTermosMateria(titulo, resumo, tituloReferencia);
  const obrigatorios = new Set(termosMateria.filter((t) => t.length > 3));

  if (briefing?.elementos_obrigatorios?.length) {
    briefing.elementos_obrigatorios.forEach((o) => obrigatorios.add(normalizarTexto(o)));
  }

  for (const entidade of entidades) {
    const partes = partesNome(entidade);
    if (partes.length >= 2) obrigatorios.add(partes[partes.length - 1]);
    partes.forEach((p) => { if (p.length > 3) obrigatorios.add(p); });
  }

  return {
    titulo,
    resumo,
    tituloReferencia,
    conteudo: '',
    entidades,
    palavrasChave,
    termosMateria,
    assuntoImagem: briefing?.assunto_imagem || assuntoImagem || '',
    obrigatorios: [...obrigatorios].filter(Boolean),
    evitar: [...(briefing?.evitar || []), 'anime', 'crunchyroll', 'manga', 'cartoon', 'filme', 'serie', 'peaky blinders']
  };
}

function textoCombinaContexto(texto, ctx) {
  const lower = texto.toLowerCase();
  const assunto = normalizarTexto(ctx.assuntoImagem);
  if (assunto.length > 8) {
    const termosAssunto = assunto.split(/\s+/).filter((p) => p.length > 3 && !STOPWORDS.has(p));
    const acertosAssunto = termosAssunto.filter((p) => lower.includes(p));
    if (acertosAssunto.length >= 2) return true;
  }

  if (ctx.entidades.some((e) => imagemCombinaEntidade(lower, e))) return true;

  const acertos = ctx.palavrasChave.filter((p) => lower.includes(p));
  return acertos.length >= 2 || (ctx.palavrasChave.length === 1 && acertos.length === 1);
}

function urlImagemIrrelevante(url, ctx = { entidades: [], palavrasChave: [], assuntoImagem: '' }, { rigoroso = true } = {}) {
  if (urlImagemInvalida(url)) return true;
  const lower = url.toLowerCase();
  if (TERMOS_IMAGEM_REJEITADOS.some((t) => lower.includes(t))) return true;

  if (!rigoroso) return false;

  const temContexto = ctx.entidades.length > 0 || ctx.palavrasChave.length > 0 || ctx.assuntoImagem.length > 8;
  if (!temContexto) return false;

  if (ctx.entidades.length) {
    return false;
  }

  const ehGenerica = IMAGEM_GENERICA.some((t) => lower.includes(t));
  if (ehGenerica && !textoCombinaContexto(lower, ctx)) return true;

  return false;
}

function montarConsultasImagem({ termosImagem, assuntoImagem, titulo, resumo, nicho, pessoaPrincipal, entidades }) {
  const consultas = [];
  const add = (q) => {
    if (q && q.trim().length > 3) consultas.push(q.trim());
  };

  for (const entidade of entidades) {
    montarConsultasPessoa(entidade).forEach(add);
  }

  if (pessoaPrincipal && pareceNomeProprio(pessoaPrincipal) && !entidades.includes(pessoaPrincipal)) {
    montarConsultasPessoa(pessoaPrincipal).forEach(add);
  }

  if (assuntoImagem) {
    add(assuntoImagem);
    assuntoImagem.split(/[,;]+/).map((t) => t.trim()).filter((t) => t.length > 3).forEach(add);
  }

  if (termosImagem) {
    termosImagem.split(/[,;]+/).forEach((t) => add(t.trim()));
  }

  if (titulo) {
    add(`"${titulo.split(/\s+/).slice(0, 7).join(' ')}"`);
    const palavras = titulo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length > 3 && !STOPWORDS.has(p.toLowerCase()));
    if (palavras.length >= 2) add(palavras.slice(0, 5).join(' '));
  }

  if (resumo) {
    const palavrasResumo = resumo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter((p) => p.length > 4 && !STOPWORDS.has(p.toLowerCase()))
      .slice(0, 5)
      .join(' ');
    if (palavrasResumo) add(palavrasResumo);
  }

  if (!entidades.length) {
    montarConsultasContextuais(titulo, resumo, assuntoImagem, entidades).forEach(add);
  }

  if (nicho && !entidades.length) add(`${nicho} gospel brasil evento`);

  return [...new Set(consultas)];
}

function pontuarImagemStock(img, ctx) {
  const texto = `${img.title || ''} ${img.url || ''} ${img.creator || ''} ${img.alt || ''}`.toLowerCase();
  let score = 0;

  const assunto = normalizarTexto(ctx.assuntoImagem);
  if (assunto) {
    for (const parte of assunto.split(/\s+/).filter((p) => p.length > 3)) {
      if (texto.includes(parte)) score -= 8;
    }
  }

  for (const e of ctx.entidades) {
    const partes = partesNome(e);
    for (const parte of partes) {
      if (texto.includes(parte)) score -= 15;
    }
    if (imagemCombinaEntidade(texto, e)) score -= 40;
    else if (partes.length >= 2 && texto.includes(partes[0]) && !texto.includes(partes[partes.length - 1])) {
      score += 25;
    }
  }

  for (const p of ctx.palavrasChave) {
    if (texto.includes(p)) score -= 4;
  }

  if (texto.includes('brazil') || texto.includes('brasil')) score -= 2;
  if (texto.includes('gospel') || texto.includes('worship') || texto.includes('preaching') || texto.includes('singer')) score -= 2;
  if (texto.includes('microphone') || texto.includes('microfone') || texto.includes('congregation') || texto.includes('crowd')) score -= 1;

  const contexto = (img.contextLink || '').toLowerCase();
  if (/gospel|evangel|adoracao|adoracão|louvor|igreja|christian|worship/.test(contexto)) score -= 5;
  if (/g1\.|globo\.|uol\.|terra\.|record|band|folha|estadao|cnn|bbc|reuters/.test(contexto)) score -= 3;

  if (IMAGEM_GENERICA.some((t) => texto.includes(t)) && !textoCombinaContexto(texto, ctx)) score += 15;
  if (urlImagemProibida(img.url, img.contextLink)) score += 100;

  for (const t of ctx.termosMateria || []) {
    if (texto.includes(normalizarTexto(t))) score -= 12;
  }

  return score;
}

function passaFiltroImagem(img, ctx) {
  if (!img?.url || urlImagemInvalida(img.url) || urlImagemProibida(img.url, img.contextLink)) return false;
  if (imagemPessoaInadequada(img, ctx)) return false;
  const texto = `${img.title || ''} ${img.url || ''} ${img.alt || ''} ${img.contextLink || ''}`;
  const lowerUrl = img.url.toLowerCase();
  const norm = normalizarTexto(texto);
  if (TERMOS_IMAGEM_REJEITADOS.some((t) => lowerUrl.includes(t))) return false;
  if (img.width && img.height && (img.width < 400 || img.height < 250)) return false;

  if (ctx.evitar?.length) {
    const evitarNorm = ctx.evitar.map((e) => normalizarTexto(e));
    if (evitarNorm.some((e) => e.length > 3 && norm.includes(e))) return false;
  }

  if (img.fromFonte || img.fromNoticia) {
    return passaFiltroBasico(img)
      && !imagemUrlGenerica(img.url)
      && imagemCombinaMateria(img, ctx);
  }

  if (!imagemCombinaMateria(img, ctx)) return false;

  const ehGenerica = IMAGEM_GENERICA.some((t) => norm.includes(t));
  if (ehGenerica && !textoCombinaContexto(norm, ctx)) return false;

  return true;
}

function montarConsultaWeb(termos, ctx) {
  if (ctx.entidades.length) {
    const ctxNoticia = extrairPalavrasMateria(ctx.titulo, ctx.resumo, ctx.tituloReferencia).slice(0, 3).join(' ');
    return `${ctx.entidades[0]} ${ctxNoticia || 'noticia'}`.trim();
  }

  const partes = [termos];
  if (ctx.assuntoImagem) {
    const assuntoCurto = ctx.assuntoImagem.split(/[,.]/)[0].trim();
    if (assuntoCurto.length > 8 && assuntoCurto.length < 80) partes.unshift(assuntoCurto);
  }
  const palavras = extrairPalavrasMateria(ctx.titulo, ctx.resumo, ctx.tituloReferencia).slice(0, 5);
  if (palavras.length) partes.push(palavras.join(' '));
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

let googleIndisponivelAvisado = false;

function extrairDominio(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function passaFiltroBasico(img) {
  if (!img?.url || urlImagemInvalida(img.url)) return false;
  if (urlImagemProibida(img.url, img.contextLink)) return false;
  const lower = img.url.toLowerCase();
  return !TERMOS_IMAGEM_REJEITADOS.some((t) => lower.includes(t));
}

function imagemUrlGenerica(url) {
  const norm = normalizarTexto(url || '');
  return IMAGEM_GENERICA.some((t) => norm.includes(t));
}

function montarConsultasNoticia({ tituloReferencia, titulo, resumo, urlFonte, entidades, briefing }) {
  const consultas = [];
  const add = (q) => { if (q && q.trim().length > 5) consultas.push(q.trim()); };

  add(tituloReferencia);
  if (titulo && titulo !== tituloReferencia) add(titulo);
  if (tituloReferencia && resumo) {
    add(`${tituloReferencia} ${resumo.split(/\s+/).slice(0, 8).join(' ')}`);
  }

  const dominio = extrairDominio(urlFonte);
  if (dominio && tituloReferencia && serperPermiteConsultasAvancadas()) {
    const palavras = tituloReferencia.split(/\s+/).slice(0, 6).join(' ');
    add(`site:${dominio} ${palavras}`);
  }

  for (const entidade of entidades.slice(0, 2)) {
    add(`${entidade} gospel noticia`);
    add(`${entidade} foto`);
  }

  if (briefing?.termos_busca?.length) {
    briefing.termos_busca.forEach(add);
  }

  return [...new Set(consultas)];
}

function montarConsultasExpandidas({ titulo, tituloReferencia, resumo, assuntoImagem, entidades, briefing }) {
  const consultas = montarConsultasNoticia({ tituloReferencia, titulo, resumo, entidades, briefing });
  if (assuntoImagem) consultas.push(assuntoImagem);
  if (titulo) consultas.push(`${titulo} imagem`);
  if (tituloReferencia) consultas.push(`"${tituloReferencia}"`);
  return [...new Set(consultas)];
}

function ordenarCandidatos(candidatos, ctx) {
  return [...candidatos].sort((a, b) => {
    const bonusA = (a.fromFonte ? 30 : 0) + (a.fromNoticia ? 20 : 0) + (a.fromSerper ? 15 : 0);
    const bonusB = (b.fromFonte ? 30 : 0) + (b.fromNoticia ? 20 : 0) + (b.fromSerper ? 15 : 0);
    return (pontuarImagemStock(a, ctx) - bonusA) - (pontuarImagemStock(b, ctx) - bonusB);
  });
}

function mesclarCandidatos(listas) {
  const vistos = new Set();
  const todos = [];
  for (const lista of listas) {
    for (const img of lista) {
      if (!img?.url || vistos.has(img.url)) continue;
      vistos.add(img.url);
      todos.push(img);
    }
  }
  return todos;
}

function serperImagensAtivo() {
  return serperDisponivel();
}

async function buscarSerperImagens(termos, ctx, { consultaDireta = false, filtroRigoroso = true, num = 20 } = {}) {
  if (!serperImagensAtivo()) return [];

  const consulta = consultaDireta ? termos : montarConsultaWeb(termos, ctx);
  if (/\bsite:/i.test(consulta) && !serperPermiteConsultasAvancadas()) return [];

  const { ok, data, bloqueado, ignorado, texto, status } = await serperPost('images', {
    q: consulta,
    gl: 'br',
    hl: 'pt-br',
    num: Math.min(Math.max(num, 10), 40)
  }, { timeoutMs: 12000 });

  if (ignorado) return [];
  if (!ok) {
    if (!bloqueado) console.warn('Serper Imagens API:', status, (texto || '').slice(0, 250));
    return [];
  }

  try {
    return (data.images || [])
      .map((item) => ({
        url: item.imageUrl || item.thumbnailUrl,
        thumbnail: item.thumbnailUrl || item.imageUrl || '',
        title: item.title || '',
        alt: item.title || '',
        contextLink: item.link || item.source || '',
        width: item.imageWidth || 0,
        height: item.imageHeight || 0,
        fromSerper: true
      }))
      .filter((img) => {
        if (!img.url) return false;
        if (!filtroRigoroso) return passaFiltroBasico(img) && !imagemUrlGenerica(img.url);
        return passaFiltroImagem(img, ctx);
      })
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx));
  } catch (e) {
    console.warn('buscarSerperImagens:', e.message);
    return [];
  }
}

async function coletarCandidatosBuscaImagem(consultas, ctx, { focoPessoa = [], maxConsultas = 6 } = {}) {
  const vistos = new Set();
  const candidatos = [];

  const adicionar = (lista) => {
    for (const img of lista) {
      if (!img?.url || vistos.has(img.url)) continue;
      if (!passaFiltroBasico(img)) continue;
      if (imagemPessoaInadequada(img, ctx)) continue;
      if (focoPessoa.length && !imagemMencionaPessoa(img, focoPessoa)) continue;
      vistos.add(img.url);
      candidatos.push(img);
    }
  };

  for (const q of [...new Set(consultas)].filter(Boolean).slice(0, maxConsultas)) {
    if (serperDisponivel()) {
      adicionar(await buscarSerperImagens(q, ctx, { consultaDireta: true, filtroRigoroso: false, num: 25 }));
    }
    if (braveDisponivel()) {
      adicionar(await buscarBraveImagens(q, ctx, {
        consultaDireta: true,
        filtroRigoroso: !focoPessoa.length
      }));
    }
  }

  return ordenarCandidatos(candidatos, ctx);
}

async function buscarBraveImagens(termos, ctx, { consultaDireta = false, filtroRigoroso = true } = {}) {
  if (!braveDisponivel()) return [];

  const consulta = consultaDireta ? termos : montarConsultaWeb(termos, ctx);
  const params = new URLSearchParams({
    q: consulta,
    count: '25',
    country: 'BR',
    spellcheck: '1',
    safesearch: 'off'
  });

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/images/search?${params}`, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const erro = await res.text();
      marcarRespostaBrave(res, erro);
      if (!braveQuotaExcedida()) {
        console.warn('Brave Imagens API:', res.status, erro.slice(0, 250));
      }
      return [];
    }

    marcarRespostaBraveOk();

    const data = await res.json();
    return (data.results || [])
      .map((item) => ({
        url: item.properties?.url || item.thumbnail?.src,
        thumbnail: item.thumbnail?.src || item.properties?.url || '',
        title: item.title || '',
        alt: item.title || '',
        contextLink: item.url || '',
        width: item.properties?.width || item.thumbnail?.width || 0,
        height: item.properties?.height || item.thumbnail?.height || 0
      }))
      .filter((img) => {
        if (!img.url) return false;
        if (!filtroRigoroso) return passaFiltroBasico(img) && !imagemUrlGenerica(img.url);
        return passaFiltroImagem(img, ctx);
      })
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx));
  } catch (e) {
    console.warn('buscarBraveImagens:', e.message);
    return [];
  }
}

async function buscarBingImagens(termos, ctx) {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  if (!apiKey) return [];

  const consulta = montarConsultaWeb(termos, ctx);
  const params = new URLSearchParams({
    q: consulta,
    count: '15',
    imageType: 'Photo',
    size: 'Large',
    aspect: 'Wide',
    mkt: 'pt-BR'
  });

  try {
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/images/search?${params}`, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const erro = await res.text();
      console.warn('Bing Imagens API:', res.status, erro.slice(0, 250));
      return [];
    }

    const data = await res.json();
    return (data.value || [])
      .map((item) => ({
        url: item.contentUrl,
        title: item.name || '',
        alt: item.name || '',
        contextLink: item.hostPageUrl || '',
        width: item.width || 0,
        height: item.height || 0
      }))
      .filter((img) => img.url && passaFiltroImagem(img, ctx))
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx));
  } catch (e) {
    console.warn('buscarBingImagens:', e.message);
    return [];
  }
}

async function buscarGoogleImagens(termos, ctx) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId || googleIndisponivelAvisado) return [];

  const consulta = montarConsultaWeb(termos, ctx);
  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: consulta,
    searchType: 'image',
    num: '10',
    imgSize: 'large',
    imgType: 'photo',
    safe: 'off',
    lr: 'lang_pt'
  });

  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const erro = await res.text();
      if (!googleIndisponivelAvisado && erro.includes('does not have the access to Custom Search JSON API')) {
        googleIndisponivelAvisado = true;
        console.warn(
          'Google Custom Search JSON API indisponível para contas novas (Google fechou para novos clientes em 2025). ' +
          'Use BRAVE_SEARCH_API_KEY no .env como alternativa.'
        );
      } else {
        console.warn('Google Imagens API:', res.status, erro.slice(0, 250));
      }
      return [];
    }

    const data = await res.json();
    return (data.items || [])
      .map((item) => ({
        url: item.link,
        title: item.title || '',
        alt: item.snippet || '',
        contextLink: item.image?.contextLink || '',
        width: item.image?.width || 0,
        height: item.image?.height || 0
      }))
      .filter((img) => img.url && passaFiltroImagem(img, ctx))
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx));
  } catch (e) {
    console.warn('buscarGoogleImagens:', e.message);
    return [];
  }
}

async function buscarOpenverse(termos, ctx) {
  const query = encodeURIComponent(termos);
  const url = `https://api.openverse.org/v1/images/?q=${query}&page_size=20&license_type=commercial,modification`;
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
        return candidato && !urlImagemIrrelevante(candidato, ctx) && (img.height || 400) >= 300;
      })
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx))
      .map((img) => img.url || img.thumbnail);
  } catch {
    return [];
  }
}

async function buscarWikimedia(termos, ctx) {
  const query = encodeURIComponent(termos);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json&origin=*`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    const paginas = data.query?.pages;
    if (!paginas) return [];
    return Object.values(paginas)
      .map((p) => ({ url: p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url, title: p.title }))
      .filter((img) => img.url && !urlImagemIrrelevante(img.url, ctx))
      .sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx))
      .map((img) => img.url);
  } catch {
    return [];
  }
}

async function buscarImagensViaBraveWeb(consultas, ctx) {
  if (!braveDisponivel() || !consultas.length) return [];

  const candidatos = [];
  const vistos = new Set();

  for (const termo of consultas.slice(0, 4)) {
    try {
      const params = new URLSearchParams({
        q: termo,
        count: '6',
        country: 'BR',
        search_lang: 'pt-br'
      });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) {
        const erro = await res.text();
        marcarRespostaBrave(res, erro);
        break;
      }

      marcarRespostaBraveOk();

      const data = await res.json();
      const paginas = (data.web?.results || []).slice(0, 4);

      for (const pagina of paginas) {
        const meta = await extrairMetadadosArtigo(pagina.url);
        const urls = [meta.imagem, ...(meta.imagens || [])].filter(Boolean);

        for (const url of urls) {
          if (vistos.has(url) || !passaFiltroBasico({ url })) continue;
          if (imagemUrlGenerica(url)) continue;
          vistos.add(url);
          candidatos.push({
            url,
            title: meta.titulo || pagina.title || termo,
            alt: meta.descricao || pagina.description || '',
            contextLink: meta.urlReal || pagina.url,
            fromNoticia: true
          });
        }
      }
    } catch (e) {
      console.warn('buscarImagensViaBraveWeb:', e.message);
    }
  }

  return candidatos;
}

async function coletarCandidatosWeb(consultas, ctx, { consultaDireta = false, filtroRigoroso = true } = {}) {
  const temBing = !!process.env.BING_SEARCH_API_KEY;
  const temGoogle = process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID && !googleIndisponivelAvisado;
  const vistos = new Set();
  const candidatos = [];

  const adicionar = (lista) => {
    for (const img of lista) {
      if (!img?.url || vistos.has(img.url)) continue;
      vistos.add(img.url);
      candidatos.push(img);
    }
  };

  for (const termos of consultas) {
    if (serperDisponivel()) {
      adicionar(await buscarSerperImagens(termos, ctx, { consultaDireta, filtroRigoroso }));
    }
    if (braveDisponivel()) {
      adicionar(await buscarBraveImagens(termos, ctx, { consultaDireta, filtroRigoroso }));
    }
    if (filtroRigoroso) {
      adicionar(await buscarBingImagens(termos, ctx));
      adicionar(await buscarGoogleImagens(termos, ctx));
    }
  }

  if (!candidatos.length) {
    for (const termos of consultas.slice(0, 3)) {
      const urls = [
        ...(await buscarOpenverse(termos, ctx)),
        ...(await buscarWikimedia(termos, ctx))
      ];
      urls.forEach((url) => adicionar({ url, title: termos, alt: termos, contextLink: '' }));
    }
  }

  return candidatos.sort((a, b) => pontuarImagemStock(a, ctx) - pontuarImagemStock(b, ctx));
}

async function coletarCandidatosFonte(urlFonte, imagemFonte, imagensFonte, ctx, fontesApuracao = []) {
  const urls = [];
  const add = (u) => { if (u && !urls.includes(u)) urls.push(u); };

  if (imagemFonte) add(imagemFonte);
  if (Array.isArray(imagensFonte)) imagensFonte.forEach(add);

  const urlsParaBuscar = new Set();
  if (urlFonte) urlsParaBuscar.add(urlFonte);
  for (const fonte of fontesApuracao) {
    if (fonte?.url) urlsParaBuscar.add(fonte.url);
  }

  let referer = urlFonte;
  for (const url of urlsParaBuscar) {
    const meta = await extrairMetadadosArtigo(url);
    if (meta.imagens) meta.imagens.forEach(add);
    if (meta.imagem) add(meta.imagem);
    if (meta.urlReal) referer = meta.urlReal;
  }

  return urls
    .filter((u) => passaFiltroBasico({ url: u }))
    .map((url) => ({
      url,
      title: ctx.assuntoImagem || ctx.entidades.join(' ') || 'Imagem da matéria fonte',
      alt: ctx.assuntoImagem || '',
      contextLink: referer || urlFonte || '',
      fromFonte: true
    }));
}

async function baixarImagem(urlOrigem, referer) {
  if (!urlOrigem || urlImagemProibida(urlOrigem, referer)) return null;
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
    if (buffer.length < 2500 || buffer.length > 8 * 1024 * 1024) return null;

    return salvarComoWebp(buffer, 'ai');
  } catch (e) {
    console.warn('baixarImagem falhou:', urlOrigem?.slice(0, 80), e.message);
    return null;
  }
}

function origemUrl(url) {
  try {
    return new URL(url).origin + '/';
  } catch {
    return '';
  }
}

function pareceBufferImagem(buffer) {
  if (!buffer || buffer.length < 200) return false;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  if (buffer.toString('ascii', 0, 3) === 'GIF') return true;
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}

function urlImagemBloqueadaManual(url) {
  if (!url || typeof url !== 'string' || urlImagemInvalida(url)) return true;
  const lower = url.toLowerCase();
  const lixo = ['1x1', 'pixel', 'placeholder', 'favicon', 'avatar', 'logo.svg', 'sprite', 'emoji'];
  return lixo.some((t) => lower.includes(t));
}

async function tentarBaixarBytes(urlOrigem, referer, userAgent) {
  const res = await fetch(urlOrigem, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: referer || '',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(25000),
    redirect: 'follow'
  });
  if (!res.ok) return null;

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 800 || buffer.length > 8 * 1024 * 1024) return null;
  if (!contentType.startsWith('image/') && !pareceBufferImagem(buffer)) return null;
  return buffer;
}

/**
 * Download tolerante para escolha manual no admin (várias URLs e referers).
 */
async function baixarImagemManual(urlOrigem, referer, previewUrl) {
  const urls = [...new Set([urlOrigem, previewUrl].filter(Boolean))];
  const referers = [...new Set([referer, origemUrl(urlOrigem), origemUrl(referer), ''].filter((r) => r !== undefined))];
  const tentativas = [];

  for (const url of urls) {
    if (urlImagemBloqueadaManual(url)) continue;
    tentativas.push([url, referer, USER_AGENT_BROWSER]);
    tentativas.push([url, origemUrl(url), USER_AGENT_BROWSER]);
    tentativas.push([url, '', USER_AGENT_BROWSER]);
    tentativas.push([url, referer, USER_AGENT]);
  }

  for (const [url, ref, ua] of tentativas) {
    try {
      const buffer = await tentarBaixarBytes(url, ref, ua);
      if (!buffer) continue;
      try {
        const salva = await salvarComoWebp(buffer, 'ai');
        if (salva) return salva;
      } catch (e) {
        console.warn('salvarComoWebp manual:', e.message);
      }
    } catch (e) {
      console.warn('baixarImagemManual:', url?.slice(0, 80), e.message);
    }
  }

  return null;
}

async function baixarViaPaginaOrigem(sourceUrl) {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
  try {
    const meta = await extrairMetadadosArtigo(sourceUrl);
    const urls = [...new Set([meta.imagem, ...(meta.imagens || [])].filter(Boolean))];
    for (const imgUrl of urls.slice(0, 6)) {
      const salva = await baixarImagemManual(imgUrl, sourceUrl, imgUrl);
      if (salva) return salva;
    }
  } catch (e) {
    console.warn('baixarViaPaginaOrigem:', sourceUrl?.slice(0, 80), e.message);
  }
  return null;
}

async function tentarBaixarLista(urls, referer, ctx, { rigoroso = true } = {}) {
  for (const url of urls) {
    if (!url || urlImagemIrrelevante(url, ctx, { rigoroso })) continue;
    const salva = await baixarImagem(url, referer);
    if (salva) return salva;
  }
  return null;
}

async function escolherEBaixarImagem(candidatos, ctx, artigoBrief, opcoes = {}) {
  const {
    priorizarFonte = false,
    candidatosDaNoticia = false
  } = opcoes;

  if (!candidatos.length) return null;

  const ordenados = priorizarFonte
    ? ordenarCandidatos(candidatos, ctx)
    : candidatos;

  const { candidato: escolhida, rejeitouTodas } = await selecionarMelhorImagem(
    artigoBrief,
    ordenados.slice(0, 15),
    { candidatosDaNoticia: candidatosDaNoticia || priorizarFonte }
  );

  if (rejeitouTodas && !priorizarFonte) return null;

  const fila = [];
  if (escolhida) fila.push(escolhida);
  else if (!rejeitouTodas) {
    for (const img of ordenados) {
      if (!fila.some((f) => f.url === img.url)) fila.push(img);
    }
  } else if (priorizarFonte) {
    for (const img of ordenados.filter((c) => c.fromFonte || c.fromNoticia)) {
      if (imagemCombinaMateria(img, ctx) && !fila.some((f) => f.url === img.url)) fila.push(img);
    }
  }

  for (const img of fila.slice(0, 8)) {
    if (imagemUrlGenerica(img.url) || urlImagemProibida(img.url, img.contextLink)) continue;
    if (imagemPessoaInadequada(img, ctx)) continue;
    if (!imagemCombinaMateria(img, ctx)) continue;

    const ok = await validarImagemParaArtigo(artigoBrief, img);
    if (!ok) continue;

    const salva = await baixarImagem(img.url, img.contextLink);
    if (salva) return { imagem: salva, candidato: img };
  }

  return null;
}

async function obterImagemParaArtigo({
  termosImagem,
  assuntoImagem,
  pessoaPrincipal,
  titulo,
  resumo,
  conteudo,
  nicho,
  tituloReferencia,
  urlFonte,
  imagemFonte,
  imagensFonte,
  fontesApuracao
}) {
  let briefing = null;
  try {
    briefing = await identificarCapaArtigo({
      titulo,
      resumo,
      conteudo: conteudo || resumo,
      pessoaPrincipal
    });
  } catch (e) {
    console.warn('identificarCapaArtigo:', e.message);
  }

  const pessoaFinal = briefing?.pessoa_principal || pessoaPrincipal;
  const entidades = extrairEntidades(titulo, resumo, pessoaFinal);
  const pessoasArtigo = [...new Set(entidades.filter((e) => pareceNomeProprio(e)))];
  const focoPessoa = pessoasArtigo.length ? pessoasArtigo : [];

  const ctx = criarContextoRelevancia({
    titulo: focoPessoa.length ? focoPessoa.join(' ') : titulo,
    resumo,
    assuntoImagem: briefing?.assunto_imagem || assuntoImagem,
    termosImagem,
    pessoaPrincipal: pessoaFinal,
    entidades: focoPessoa.length ? focoPessoa : entidades,
    briefing,
    tituloReferencia
  });
  ctx.conteudo = textoPlano(conteudo || resumo);

  const artigoBrief = {
    titulo,
    resumo,
    conteudo,
    assuntoImagem: ctx.assuntoImagem,
    pessoaPrincipal: pessoaFinal
  };

  async function tentarCapa(candidatos, opcoes) {
    const resultado = await escolherEBaixarImagem(candidatos, ctx, artigoBrief, opcoes);
    if (!resultado?.imagem) return null;
    let alt = null;
    try {
      alt = await gerarAltImagem(artigoBrief);
    } catch (e) {
      console.warn('gerarAltImagem:', e.message);
      alt = `${titulo} — capa`.slice(0, 125);
    }
    return { imagem: resultado.imagem, alt };
  }

  const consultasImagem = [
    ...(briefing?.termos_busca || []),
    ...montarConsultasImagem({
      termosImagem,
      assuntoImagem: ctx.assuntoImagem,
      titulo,
      resumo,
      nicho,
      pessoaPrincipal: pessoaFinal,
      entidades: focoPessoa.length ? focoPessoa : entidades
    })
  ];

  if (focoPessoa.length) {
    focoPessoa.forEach((nome) => montarConsultasPessoaFoco(nome).forEach((q) => consultasImagem.unshift(q)));
    if (ctx.assuntoImagem) consultasImagem.unshift(ctx.assuntoImagem);
  }

  const consultasImagemUnicas = [...new Set(consultasImagem.filter(Boolean))];

  const consultasNoticia = montarConsultasNoticia({
    tituloReferencia: tituloReferencia || titulo,
    titulo,
    resumo,
    urlFonte,
    entidades,
    briefing
  });

  const consultasExpandidas = montarConsultasExpandidas({
    titulo,
    tituloReferencia: tituloReferencia || titulo,
    resumo,
    assuntoImagem: ctx.assuntoImagem,
    entidades,
    briefing
  });

  // Fase 1: imagem da matéria fonte (og:image do link apurado)
  const candidatosFonte = await coletarCandidatosFonte(
    urlFonte, imagemFonte, imagensFonte, ctx, fontesApuracao
  );
  let capa = await tentarCapa(candidatosFonte, {
    priorizarFonte: true,
    candidatosDaNoticia: true
  });
  if (capa) return capa;

  // Fase 2: Serper (Google Imagens) + Brave Imagens — prioridade para capa correta
  const candidatosApis = await coletarCandidatosBuscaImagem(
    consultasImagemUnicas,
    ctx,
    { focoPessoa, maxConsultas: focoPessoa.length ? 8 : 6 }
  );
  capa = await tentarCapa(candidatosApis, {});
  if (capa) return capa;

  // Fase 3: og:image de notícias (evitar quando o foco é uma pessoa — traz capas erradas)
  let candidatosNoticia = [];
  if (!focoPessoa.length) {
    candidatosNoticia = await buscarImagensViaBraveWeb(consultasNoticia, ctx);
    capa = await tentarCapa(candidatosNoticia, {
      priorizarFonte: true,
      candidatosDaNoticia: true
    });
    if (capa) return capa;
  }

  const candidatosWeb = await coletarCandidatosWeb(
    consultasImagemUnicas,
    ctx,
    { consultaDireta: true, filtroRigoroso: true }
  );
  capa = await tentarCapa(
    mesclarCandidatos([candidatosFonte, candidatosNoticia, candidatosWeb]),
    {}
  );
  if (capa) return capa;

  const candidatosNoticia2 = focoPessoa.length
    ? []
    : await buscarImagensViaBraveWeb(consultasExpandidas, ctx);
  const candidatosWeb2 = await coletarCandidatosWeb(
    consultasExpandidas,
    ctx,
    { consultaDireta: true, filtroRigoroso: true }
  );

  const ultimaTentativa = mesclarCandidatos([
    candidatosFonte,
    candidatosNoticia,
    candidatosNoticia2,
    candidatosWeb,
    candidatosWeb2
  ]).filter((c) => {
    if (c.fromFonte || c.fromNoticia) return passaFiltroBasico(c);
    return passaFiltroImagem(c, ctx);
  });

  capa = await tentarCapa(ordenarCandidatos(ultimaTentativa, ctx), {
    priorizarFonte: true,
    candidatosDaNoticia: true
  });

  if (!capa) {
    console.warn('Node não achou capa, tentando buscador Python:', titulo?.slice(0, 60));
    try {
      const python = await buscarImagemPython({
        titulo,
        resumo,
        conteudo,
        titulo_referencia: tituloReferencia || titulo,
        url_fonte: urlFonte,
        assunto_imagem: ctx.assuntoImagem,
        pessoa_principal: pessoaFinal,
        termos_busca: [
          ...(briefing?.termos_busca || []),
          ...(termosImagem ? termosImagem.split(/[,;]+/).map((t) => t.trim()) : [])
        ].filter(Boolean)
      });
      if (python?.imagem) {
        let alt = python.alt;
        try {
          alt = await gerarAltImagem(artigoBrief);
        } catch (e) {
          console.warn('gerarAltImagem (pós-Python):', e.message);
        }
        return { imagem: python.imagem, alt: alt || python.alt };
      }
    } catch (e) {
      console.warn('Fallback Python falhou:', e.message);
    }
    console.warn('Nenhuma imagem adequada encontrada para:', titulo?.slice(0, 60));
    return { imagem: null, alt: null };
  }

  return capa;
}

function formatarCandidatoManual(img) {
  if (!img?.url) return null;
  const titulo = decodificarHtmlEntidades(img.title || img.alt || '').slice(0, 200);
  return {
    url: img.url,
    preview: img.thumbnail || img.url,
    title: titulo,
    source: decodificarHtmlEntidades(img.contextLink || img.source || '')
  };
}

function chaveUnicaCandidato(img) {
  const url = (img.url || '').split('?')[0];
  const titulo = normalizarTexto(decodificarHtmlEntidades(img.title || '')).slice(0, 70);
  return `${url}|${titulo}`;
}

/**
 * Busca imagens na web para escolha manual no admin (notícias reais + Brave/Bing).
 */
async function buscarCandidatosCapaManual({
  titulo,
  resumo,
  termosBusca,
  assuntoImagem,
  pessoaPrincipal
}) {
  const focoPessoa = extrairPessoaDosTermos(termosBusca, '');
  const organizacoes = focoPessoa.length ? [] : extrairOrganizacoes(titulo, resumo);
  const entidades = [...new Set([
    ...focoPessoa,
    ...extrairEntidades(titulo, resumo, pessoaPrincipal),
    ...extrairPessoaDosTermos(titulo, ''),
    ...(focoPessoa.length ? [] : organizacoes)
  ])];

  const ctx = criarContextoRelevancia({
    titulo: focoPessoa.length ? focoPessoa.join(' ') : titulo,
    resumo,
    assuntoImagem: focoPessoa[0] || assuntoImagem,
    termosImagem: termosBusca,
    pessoaPrincipal: focoPessoa[0] || pessoaPrincipal,
    entidades: focoPessoa.length ? focoPessoa : entidades,
    tituloReferencia: titulo
  });

  let consultas = [];

  if (focoPessoa.length) {
    focoPessoa.forEach((nome) => montarConsultasPessoaFoco(nome).forEach((q) => consultas.push(q)));
    if (termosBusca && String(termosBusca).trim()) {
      consultas.push(String(termosBusca).trim());
    }
  } else {
    if (termosBusca && String(termosBusca).trim()) {
      consultas = String(termosBusca)
        .split(/[,;]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 3);
    }

    consultas = [...new Set([
      ...consultas,
      ...montarConsultasCapaManual({ titulo, resumo, assuntoImagem, entidades, organizacoes }),
      ...montarConsultasImagem({
        termosImagem: termosBusca,
        assuntoImagem,
        titulo,
        resumo,
        entidades,
        pessoaPrincipal
      })
    ])];
  }

  consultas = [...new Set(consultas.filter(Boolean))];
  if (!consultas.length && titulo) consultas.push(titulo.trim());

  const vistos = new Set();
  const brutos = [];
  const filtroOpts = { focoPessoa };

  const adicionarBruto = (lista, extras = {}) => {
    for (const img of lista) {
      if (!img?.url) continue;
      const chave = chaveUnicaCandidato(img);
      if (vistos.has(chave)) continue;
      if (!passaFiltroManual(img, ctx, filtroOpts)) continue;
      vistos.add(chave);
      brutos.push({ ...img, ...extras });
    }
  };

  // Modo pessoa: Serper (Google Imagens) primeiro, depois Brave
  if (focoPessoa.length) {
    for (const q of consultas.slice(0, 6)) {
      if (serperDisponivel()) {
        adicionarBruto(await buscarSerperImagens(q, ctx, { consultaDireta: true, filtroRigoroso: false, num: 25 }));
      }
      if (braveDisponivel()) {
        adicionarBruto(await buscarBraveImagens(q, ctx, { consultaDireta: true, filtroRigoroso: false }));
      }
    }
  } else {
    if (serperDisponivel()) {
      for (const q of consultas.slice(0, 4)) {
        adicionarBruto(await buscarSerperImagens(q, ctx, { consultaDireta: true, filtroRigoroso: false, num: 20 }));
      }
    }
    adicionarBruto(await buscarImagensViaBraveWeb(consultas, ctx));
    if (braveDisponivel()) {
      for (const q of consultas.slice(0, 5)) {
        adicionarBruto(await buscarBraveImagens(q, ctx, { consultaDireta: true, filtroRigoroso: true }));
      }
    }
  }

  if (process.env.BING_SEARCH_API_KEY) {
    for (const q of consultas.slice(0, 3)) {
      adicionarBruto(await buscarBingImagens(q, ctx));
    }
  }

  if (brutos.length < 6 && braveDisponivel()) {
    for (const q of consultas.slice(0, 3)) {
      const imgs = await buscarBraveImagens(q, ctx, { consultaDireta: true, filtroRigoroso: false });
      adicionarBruto(imgs.filter((img) => (
        focoPessoa.length
          ? imagemMencionaPessoa(img, focoPessoa)
          : imagemCombinaMateriaManual(img, ctx)
      )));
    }
  }

  if (brutos.length < 4) {
    try {
      const python = await listarImagensPython({
        titulo: focoPessoa[0] || titulo,
        resumo,
        assunto_imagem: focoPessoa[0] || assuntoImagem || '',
        termos_busca: consultas.slice(0, 6),
        modo: 'listar'
      });
      if (python?.length) {
        adicionarBruto(python.map((c) => ({
          url: c.url,
          thumbnail: c.preview || c.url,
          title: c.title || '',
          contextLink: c.source || ''
        })));
      }
    } catch (e) {
      console.warn('listarImagensPython:', e.message);
    }
  }

  const ordenados = ordenarCandidatos(brutos, ctx);

  return ordenados
    .map(formatarCandidatoManual)
    .filter(Boolean)
    .slice(0, 24);
}

async function salvarCandidatoComoCapa({ url, preview, contextLink, titulo, resumo, assuntoImagem, alt }) {
  if (!url && !preview) return null;

  let salva = await baixarImagemManual(url, contextLink || '', preview || '');

  if (!salva && contextLink) {
    salva = await baixarViaPaginaOrigem(contextLink);
  }

  if (!salva) {
    try {
      const python = await baixarImagemUrlPython({
        url: url || preview,
        preview: preview || url,
        source: contextLink || '',
        titulo: titulo || '',
        resumo: resumo || ''
      });
      if (python?.imagem) salva = python.imagem;
    } catch (e) {
      console.warn('baixarImagemUrlPython:', e.message);
    }
  }

  if (!salva) return null;

  let altFinal = (alt || '').trim();
  if (!altFinal && titulo) {
    try {
      altFinal = await gerarAltImagem({ titulo, resumo, assuntoImagem });
    } catch {
      altFinal = titulo.slice(0, 125);
    }
  }

  return { imagem: salva, alt: altFinal || null };
}

module.exports = {
  obterImagemParaArtigo,
  baixarImagem,
  extrairEntidades,
  buscarCandidatosCapaManual,
  salvarCandidatoComoCapa,
  avisoFalhaImagem() {
    if (braveQuotaExcedida()) {
      return 'API Brave temporariamente pausada (limite atingido). Se você já aumentou o limite no painel, aguarde ~1 min ou reinicie o servidor e tente de novo. Enquanto isso, envie a capa manualmente.';
    }
    if (!process.env.SERPER_API_KEY && !braveDisponivel()) {
      return 'Configure SERPER_API_KEY (serper.dev — Google Imagens, 2500 buscas grátis) ou BRAVE_SEARCH_API_KEY para buscar capas automaticamente.';
    }
    return 'Não foi possível baixar imagem automaticamente. Use "Buscar imagem na web" na barra lateral ou envie uma capa manualmente.';
  }
};
