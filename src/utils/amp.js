function ampAtivo(config) {
  return (config.amp_habilitado || 'nao') === 'sim';
}

function escapeHtml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function urlAbsoluta(base, caminho) {
  if (!caminho) return '';
  if (/^https?:\/\//i.test(caminho)) return caminho;
  const raiz = (base || '').replace(/\/+$/, '');
  return `${raiz}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}

function extrairClientAdSense(codigo) {
  const match = String(codigo || '').match(/ca-pub-\d+/i);
  return match ? match[0] : '';
}

function sanitizarConteudoAmp(html, base) {
  if (!html) return '';

  let conteudo = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/\s(on\w+|style)="[^"]*"/gi, '');

  conteudo = conteudo.replace(/<img\b([^>]*?)>/gi, (tag, attrs) => {
    const srcMatch = attrs.match(/\ssrc=["']([^"']+)["']/i);
    if (!srcMatch) return '';
    const src = urlAbsoluta(base, srcMatch[1]);
    const altMatch = attrs.match(/\salt=["']([^"']*)["']/i);
    const alt = escapeHtml(altMatch ? altMatch[1] : '');
    return `<amp-img src="${escapeHtml(src)}" width="800" height="450" layout="responsive" alt="${alt}"></amp-img>`;
  });

  conteudo = conteudo
    .replace(/<video[\s\S]*?<\/video>/gi, '')
    .replace(/<audio[\s\S]*?<\/audio>/gi, '');

  return conteudo;
}

function urlAmpPost(base, slug) {
  return `${(base || '').replace(/\/+$/, '')}/post/${slug}/amp`;
}

module.exports = {
  ampAtivo,
  escapeHtml,
  urlAbsoluta,
  extrairClientAdSense,
  sanitizarConteudoAmp,
  urlAmpPost
};
