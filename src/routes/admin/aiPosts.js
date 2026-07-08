const router = require('express').Router();
const { Post } = require('../../models');
const { permitir } = require('../../middlewares/auth');
const { gerarArtigo } = require('../../services/deepseek');
const { pesquisarNichos, apurarTopico } = require('../../services/newsResearch');
const { obterImagemParaArtigo } = require('../../services/imageFetcher');

router.use(permitir('administrador', 'gestor'));

function responderJson(res, status, payload) {
  res.status(status).json(payload);
}

async function prepararTopico(topico) {
  if (!topico) return null;
  if (topico.contextoApuracao) return topico;
  return apurarTopico(topico);
}

async function gerarArtigoCompleto(topico, nomeSite) {
  const apurado = await prepararTopico(topico);

  const artigo = await gerarArtigo({
    tituloReferencia: apurado.titulo,
    resumoReferencia: apurado.resumo,
    fonte: apurado.link,
    nicho: apurado.nicho,
    nomeSite,
    contextoApuracao: apurado.contextoApuracao,
    fontesApuracao: apurado.fontesApuracao,
    dataReferencia: apurado.dataReferencia || apurado.data,
    emAlta: apurado.emAlta
  });

  const imagem = await obterImagemParaArtigo({
    termosImagem: artigo.termos_imagem,
    assuntoImagem: artigo.assunto_imagem,
    pessoaPrincipal: artigo.pessoa_principal,
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    nicho: apurado.nicho,
    urlFonte: apurado.linkOriginal || apurado.link,
    imagemFonte: apurado.imagemFonte,
    imagensFonte: apurado.imagensFonte
  });

  return { artigo, imagem, topico: apurado };
}

router.post('/pesquisar', async (req, res) => {
  try {
    const { palavrasChave, quantidadePorNicho } = req.body;
    const topicos = await pesquisarNichos(
      palavrasChave || 'gospel',
      Math.min(Math.max(parseInt(quantidadePorNicho, 10) || 5, 1), 10)
    );
    responderJson(res, 200, { ok: true, topicos });
  } catch (e) {
    responderJson(res, 400, { ok: false, erro: e.message });
  }
});

router.post('/gerar-preview', async (req, res) => {
  try {
    const { topico } = req.body;
    if (!topico?.titulo) {
      return responderJson(res, 400, { ok: false, erro: 'Tópico inválido.' });
    }

    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';
    const { artigo, imagem, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite);

    responderJson(res, 200, {
      ok: true,
      artigo: { ...artigo, imagem },
      avisoImagem: imagem ? null : 'Não foi possível baixar imagem automaticamente. Envie uma capa manualmente.'
    });
  } catch (e) {
    console.error('Erro gerar-preview:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/gerar-lote', async (req, res) => {
  try {
    const { topicos, categoriaId, status, destaque } = req.body;
    if (!Array.isArray(topicos) || !topicos.length) {
      return responderJson(res, 400, { ok: false, erro: 'Selecione ao menos um tópico.' });
    }

    const limite = Math.min(topicos.length, 10);
    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';
    const criados = [];
    const erros = [];

    for (let i = 0; i < limite; i++) {
      const topico = topicos[i];
      try {
        const { artigo, imagem } = await gerarArtigoCompleto(topico, nomeSite);

        const post = await Post.create({
          titulo: artigo.titulo,
          resumo: artigo.resumo,
          conteudo: artigo.conteudo,
          categoriaId: categoriaId || null,
          autorId: req.session.user.id,
          status: status === 'publicado' ? 'publicado' : 'rascunho',
          destaque: destaque === true || destaque === 'true',
          metaTitle: artigo.meta_title || null,
          metaDescription: artigo.meta_description || null,
          imagem
        });

        criados.push({ id: post.id, titulo: post.titulo, slug: post.slug, imagem: post.imagem });
      } catch (e) {
        erros.push({ titulo: topico.titulo, erro: e.message });
      }
    }

    responderJson(res, 200, {
      ok: true,
      criados,
      erros,
      mensagem: `${criados.length} matéria(s) criada(s)${erros.length ? `, ${erros.length} com erro` : ''}.`
    });
  } catch (e) {
    console.error('Erro gerar-lote:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/preencher-formulario', async (req, res) => {
  try {
    const { palavrasChave } = req.body;
    const topicos = await pesquisarNichos(palavrasChave || 'gospel', 1);
    const topico = topicos[0];
    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';

    const { artigo, imagem, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite);

    responderJson(res, 200, {
      ok: true,
      artigo: { ...artigo, imagem, topico: apurado },
      avisoImagem: imagem ? null : 'Não foi possível baixar imagem automaticamente. Envie uma capa manualmente.'
    });
  } catch (e) {
    console.error('Erro preencher-formulario:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

module.exports = router;
