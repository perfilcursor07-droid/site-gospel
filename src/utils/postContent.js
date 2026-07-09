function dividirConteudoParaLeiaMais(conteudo) {
  if (!conteudo || typeof conteudo !== 'string') {
    return { parte1: conteudo || '', parte2: '' };
  }

  const fechamentos = [...conteudo.matchAll(/<\/p>/gi)];
  const alvo = fechamentos.length >= 3 ? fechamentos[2] : fechamentos[0];

  if (!alvo) {
    const h2 = conteudo.match(/<\/h2>/i);
    if (h2) {
      const idx = h2.index + h2[0].length;
      return { parte1: conteudo.slice(0, idx), parte2: conteudo.slice(idx) };
    }
    return { parte1: conteudo, parte2: '' };
  }

  const idx = alvo.index + alvo[0].length;
  return { parte1: conteudo.slice(0, idx), parte2: conteudo.slice(idx) };
}

module.exports = { dividirConteudoParaLeiaMais };
