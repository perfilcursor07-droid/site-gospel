const slugify = require('slugify');

const STOPWORDS = new Set([
  'sera', 'ser', 'atracao', 'principal', 'noticias', 'diz', 'chega', 'neste', 'nesta',
  'para', 'como', 'mais', 'sobre', 'apos', 'após', 'show', 'noite', 'que', 'com',
  'uma', 'seu', 'sua', 'pelo', 'pela', 'dos', 'das', 'nos', 'nas', 'aos', 'the',
  'this', 'that', 'from', 'with', 'will', 'have', 'been', 'were', 'they', 'their',
  'gospel', 'evangelico', 'evangélico', 'igreja', 'culto', 'louvor', 'brasil',
  'evento', 'programacao', 'programação', 'inclui', 'incluirá', 'ocorre', 'neste',
  'sabado', 'sábado', 'domingo', 'segunda', 'terca', 'terça', 'quarta', 'quinta',
  'sexta', 'portal', 'segundo', 'conforme', 'veja', 'repercussao', 'repercussão',
  'historica', 'histórica', 'historico', 'histórico', 'gratuito', 'gratuita'
]);

function limparTitulo(titulo) {
  return (titulo || '')
    .replace(/\s*[-–—|]\s*[^-|–—]{2,80}$/u, '')
    .replace(/[«»"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarTitulo(titulo) {
  return slugify(limparTitulo(titulo), { lower: true, strict: true });
}

function tokensSignificativos(titulo) {
  return normalizarTitulo(titulo)
    .split('-')
    .filter((p) => p.length > 2 && !STOPWORDS.has(p));
}

function extrairNomesProprios(titulo) {
  const limpo = limparTitulo(titulo);
  const padroes = [
    /\b([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das)\s+)?[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)\b/g,
    /\b([A-ZÀ-Ú]{2,}[a-zà-ú]+)\b/g
  ];
  const nomes = new Set();
  for (const padrao of padroes) {
    for (const match of limpo.matchAll(padrao)) {
      const nome = normalizarTitulo(match[1]);
      if (nome.length > 4) nomes.add(nome);
    }
  }
  return [...nomes];
}

function jaccardTitulos(a, b) {
  const ta = new Set(tokensSignificativos(a));
  const tb = new Set(tokensSignificativos(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const uniao = new Set([...ta, ...tb]).size;
  return inter / uniao;
}

function nomesCompartilhados(a, b) {
  const na = extrairNomesProprios(a);
  const nb = extrairNomesProprios(b);
  if (!na.length || !nb.length) return [];

  return na.filter((nomeA) =>
    nb.some((nomeB) => {
      const pa = nomeA.split('-').filter((p) => p.length > 2);
      const pb = nomeB.split('-').filter((p) => p.length > 2);
      if (pa.length >= 2 && pb.length >= 2) {
        return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
      }
      return nomeA === nomeB || nomeA.includes(nomeB) || nomeB.includes(nomeA);
    })
  );
}

function tokensDistintivos(titulo, resumo = '') {
  return tokensSignificativos(`${titulo || ''} ${resumo || ''}`)
    .filter((p) => p.length > 4);
}

function fatosSimilares(a, b, resumoA = '', resumoB = '') {
  if (!a || !b) return false;

  const la = limparTitulo(a);
  const lb = limparTitulo(b);
  if (titulosSimilares(la, lb)) return true;

  const textoA = `${la} ${resumoA || ''}`.trim();
  const textoB = `${lb} ${resumoB || ''}`.trim();

  if (jaccardTitulos(textoA, textoB) >= 0.32) return true;

  const nomes = nomesCompartilhados(la, lb);
  const distA = tokensDistintivos(la, resumoA);
  const distB = tokensDistintivos(lb, resumoB);
  const distComuns = distA.filter((t) => distB.includes(t));

  if (nomes.length >= 1 && distComuns.length >= 2) return true;
  if (nomes.length >= 1 && jaccardTitulos(la, lb) >= 0.18) return true;

  const pa = tokensSignificativos(textoA);
  const pb = tokensSignificativos(textoB);
  const comuns = pa.filter((w) => pb.includes(w));
  const base = Math.min(pa.length, pb.length);

  if (comuns.length >= 5) return true;
  if (comuns.length >= 4 && comuns.length / Math.max(base, 1) >= 0.45) return true;
  if (nomes.length >= 1 && comuns.length >= 3) return true;

  return false;
}

function titulosSimilares(a, b) {
  if (!a || !b) return false;

  const la = limparTitulo(a);
  const lb = limparTitulo(b);
  const na = normalizarTitulo(la);
  const nb = normalizarTitulo(lb);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const jaccard = jaccardTitulos(la, lb);
  if (jaccard >= 0.38) return true;

  const pa = tokensSignificativos(la);
  const pb = tokensSignificativos(lb);
  if (!pa.length || !pb.length) return false;

  const comuns = pa.filter((w) => pb.includes(w));
  const base = Math.min(pa.length, pb.length);
  if (comuns.length >= 4) return true;
  if (comuns.length >= 3 && comuns.length / base >= 0.55) return true;

  const nomes = nomesCompartilhados(la, lb);
  if (nomes.length && comuns.length >= 2) return true;
  if (nomes.length && jaccard >= 0.22) return true;

  return false;
}

function encontrarSimilar(titulo, lista = [], resumo = '') {
  return lista.find((item) =>
    fatosSimilares(item.titulo || item, titulo, item.resumo, resumo)
  ) || null;
}

function deduplicarTopicos(topicos = [], { modoRedes = false } = {}) {
  const unicos = [];

  for (const topico of topicos) {
    const dupIdx = unicos.findIndex((u) => {
      const linkA = u.linkOriginal || u.link;
      const linkB = topico.linkOriginal || topico.link;
      if (linkA && linkB && linkA === linkB) return true;
      if (modoRedes) {
        const na = normalizarTitulo(u.titulo);
        const nb = normalizarTitulo(topico.titulo);
        if (na && nb && na === nb) return true;
        return titulosSimilares(u.titulo, topico.titulo);
      }
      return fatosSimilares(u.titulo, topico.titulo, u.resumo, topico.resumo);
    });

    if (dupIdx === -1) {
      unicos.push(topico);
      continue;
    }

    const existente = unicos[dupIdx];
    if (topico.emAlta && !existente.emAlta) existente.emAlta = true;
    if ((topico.resumo || '').length > (existente.resumo || '').length) {
      existente.resumo = topico.resumo;
    }
    if ((topico.conteudoRede || '').length > (existente.conteudoRede || '').length) {
      existente.conteudoRede = topico.conteudoRede;
    }
    if (!existente.link && topico.link) existente.link = topico.link;
  }

  return unicos;
}

function marcarTopicosPublicados(topicos, posts = []) {
  const existentes = posts.filter((p) => p.status === 'publicado' || p.status === 'rascunho');

  return topicos.map((topico) => {
    const match = existentes.find((p) =>
      fatosSimilares(topico.titulo, p.titulo, topico.resumo, p.resumo)
    );
    return {
      ...topico,
      jaPublicado: !!match,
      postExistente: match
        ? { id: match.id, titulo: match.titulo, slug: match.slug }
        : null
    };
  });
}

module.exports = {
  titulosSimilares,
  fatosSimilares,
  marcarTopicosPublicados,
  deduplicarTopicos,
  encontrarSimilar,
  normalizarTitulo,
  limparTitulo
};
