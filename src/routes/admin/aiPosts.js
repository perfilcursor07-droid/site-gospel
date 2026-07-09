const router = require('express').Router();
const { Post } = require('../../models');
const { permitir } = require('../../middlewares/auth');
const { gerarArtigo } = require('../../services/deepseek');
const { pesquisarNichos, apurarTopico } = require('../../services/newsResearch');
const { obterImagemParaArtigo, avisoFalhaImagem } = require('../../services/imageFetcher');
const { marcarTopicosPublicados, deduplicarTopicos, encontrarSimilar } = require('../../utils/topicMatch');
const { MIN_PALAVRAS_ARTIGO, MAX_PALAVRAS_ARTIGO, mensagemAvisoQualidade, avaliarComprimento } = require('../../services/editorialGuidelines');

function avisoQualidadeArtigo(artigo) {
  if (artigo._avisoQualidade) return artigo._avisoQualidade;
  const q = avaliarComprimento(artigo.conteudo || '');
  return mensagemAvisoQualidade(q);
}

router.use(permitir('administrador', 'gestor'));

function responderJson(res, status, payload) {
  res.status(status).json(payload);
}

function statusComImagem(statusDesejado, imagem) {
  if (statusDesejado === 'publicado' && !imagem) return 'rascunho';
  return statusDesejado === 'publicado' ? 'publicado' : 'rascunho';
}

async function carregarPostsExistentes() {
  return Post.findAll({
    attributes: ['id', 'titulo', 'slug', 'status', 'resumo'],
    where: { status: ['publicado', 'rascunho'] },
    order: [['updatedAt', 'DESC']]
  });
}

function filtrarTopicosNovos(topicos, posts) {
  return marcarTopicosPublicados(deduplicarTopicos(topicos), posts).filter((t) => !t.jaPublicado);
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
    emAlta: apurado.emAlta,
    redeSocial: apurado.redeSocial || apurado.tipoFonte === 'rede_social'
  });

  const capa = await obterImagemParaArtigo({
    termosImagem: artigo.termos_imagem,
    assuntoImagem: artigo.assunto_imagem,
    pessoaPrincipal: artigo.pessoa_principal,
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    conteudo: artigo.conteudo,
    tituloReferencia: apurado.titulo,
    nicho: apurado.nicho,
    urlFonte: apurado.linkOriginal || apurado.link,
    imagemFonte: apurado.imagemFonte,
    imagensFonte: apurado.imagensFonte,
    fontesApuracao: apurado.fontesApuracao
  });

  return {
    artigo,
    imagem: capa?.imagem || null,
    imagemAlt: capa?.alt || null,
    topico: apurado
  };
}

router.post('/pesquisar', async (req, res) => {
  try {
    const { palavrasChave, quantidadePorNicho, incluirRedesSociais, somenteRecentes, diasRecentes } = req.body;
    const posts = await carregarPostsExistentes();
    const topicos = await pesquisarNichos(
      palavrasChave || 'gospel',
      Math.min(Math.max(parseInt(quantidadePorNicho, 10) || 5, 1), 10),
      {
        incluirRedesSociais: incluirRedesSociais !== false,
        somenteRecentes: somenteRecentes !== false,
        diasRecentes: Math.min(Math.max(parseInt(diasRecentes, 10) || 5, 1), 30)
      }
    );
    const topicosUnicos = deduplicarTopicos(topicos);
    const topicosMarcados = marcarTopicosPublicados(topicosUnicos, posts);
    responderJson(res, 200, { ok: true, topicos: topicosMarcados });
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

    const posts = await carregarPostsExistentes();
    const [marcado] = marcarTopicosPublicados([topico], posts);
    if (marcado.jaPublicado) {
      return responderJson(res, 400, {
        ok: false,
        erro: `Este assunto já foi publicado: "${marcado.postExistente.titulo}"`
      });
    }

    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';
    const { artigo, imagem, imagemAlt, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite);

    const duplicadoGerado = encontrarSimilar(artigo.titulo, posts, artigo.resumo);
    if (duplicadoGerado) {
      return responderJson(res, 400, {
        ok: false,
        erro: `Matéria similar já existe: "${duplicadoGerado.titulo}"`
      });
    }

    responderJson(res, 200, {
      ok: true,
      artigo: { ...artigo, imagem, imagemAlt },
      avisoImagem: imagem ? null : avisoFalhaImagem(),
      avisoQualidade: avisoQualidadeArtigo(artigo),
      palavras: artigo._palavras || null
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

    const posts = await carregarPostsExistentes();
    const topicosUnicos = deduplicarTopicos(topicos);
    const topicosValidos = marcarTopicosPublicados(topicosUnicos, posts).filter((t) => !t.jaPublicado);
    const ignorados = topicos.length - topicosValidos.length;

    if (!topicosValidos.length) {
      return responderJson(res, 400, {
        ok: false,
        erro: 'Todos os tópicos selecionados já foram publicados no site.'
      });
    }

    const limite = Math.min(topicosValidos.length, 5);
    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';
    const criados = [];
    const erros = [];
    let rascunhosSemImagem = 0;
    let textosCurtos = 0;
    let textosLongos = 0;
    const cacheTitulos = posts.map((p) => ({ id: p.id, titulo: p.titulo, slug: p.slug, resumo: p.resumo }));

    for (let i = 0; i < limite; i++) {
      const topico = topicosValidos[i];
      try {
        const duplicadoTopico = encontrarSimilar(topico.titulo, cacheTitulos, topico.resumo);
        if (duplicadoTopico) {
          erros.push({
            titulo: topico.titulo,
            erro: `Assunto similar já existe: "${duplicadoTopico.titulo}"`
          });
          continue;
        }

        const { artigo, imagem, imagemAlt } = await gerarArtigoCompleto(topico, nomeSite);

        const duplicadoGerado = encontrarSimilar(artigo.titulo, cacheTitulos, artigo.resumo);
        if (duplicadoGerado) {
          erros.push({
            titulo: topico.titulo,
            erro: `Matéria gerada similar a: "${duplicadoGerado.titulo}"`
          });
          continue;
        }

        const statusFinal = statusComImagem(status, imagem);
        if (status === 'publicado' && !imagem) rascunhosSemImagem += 1;
        if (!artigo._qualidadeOk) {
          const q = avaliarComprimento(artigo.conteudo || '');
          if (q.curto) textosCurtos += 1;
          if (q.longo) textosLongos += 1;
        }

        const post = await Post.create({
          titulo: artigo.titulo,
          resumo: artigo.resumo,
          conteudo: artigo.conteudo,
          categoriaId: categoriaId || null,
          autorId: req.session.user.id,
          status: statusFinal,
          destaque: destaque === true || destaque === 'true',
          metaTitle: artigo.meta_title || null,
          metaDescription: artigo.meta_description || null,
          imagem,
          imagemAlt: imagemAlt || null
        });

        criados.push({
          id: post.id,
          titulo: post.titulo,
          slug: post.slug,
          imagem: post.imagem,
          status: post.status,
          semImagem: !imagem,
          palavras: artigo._palavras || null,
          avisoQualidade: avisoQualidadeArtigo(artigo)
        });
        cacheTitulos.push({ id: post.id, titulo: post.titulo, slug: post.slug, resumo: post.resumo });
      } catch (e) {
        erros.push({ titulo: topico.titulo, erro: e.message });
      }
    }

    responderJson(res, 200, {
      ok: true,
      criados,
      erros,
      ignorados,
      rascunhosSemImagem,
      textosCurtos,
      textosLongos,
      mensagem: `${criados.length} matéria(s) criada(s)${ignorados ? `, ${ignorados} ignorada(s) por já publicadas` : ''}${rascunhosSemImagem ? `, ${rascunhosSemImagem} salva(s) como rascunho por falta de imagem` : ''}${textosCurtos ? `, ${textosCurtos} com texto curto (<${MIN_PALAVRAS_ARTIGO} palavras)` : ''}${textosLongos ? `, ${textosLongos} com texto longo (>${MAX_PALAVRAS_ARTIGO} palavras)` : ''}${erros.length ? `, ${erros.length} com erro` : ''}.`
    });
  } catch (e) {
    console.error('Erro gerar-lote:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/preencher-formulario', async (req, res) => {
  try {
    const { palavrasChave, incluirRedesSociais } = req.body;
    const topicos = await pesquisarNichos(palavrasChave || 'gospel', 1, {
      incluirRedesSociais: req.body.incluirRedesSociais !== false,
      somenteRecentes: req.body.somenteRecentes !== false,
      diasRecentes: Math.min(Math.max(parseInt(req.body.diasRecentes, 10) || 7, 1), 30)
    });
    const posts = await carregarPostsExistentes();
    const topicosUnicos = deduplicarTopicos(topicos);
    const novos = marcarTopicosPublicados(topicosUnicos, posts).filter((t) => !t.jaPublicado);
    const topico = novos[0];
    if (!topico) {
      return responderJson(res, 400, {
        ok: false,
        erro: 'Nenhum tópico novo encontrado. Todos os assuntos já foram publicados.'
      });
    }
    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';

    const { artigo, imagem, imagemAlt, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite);

    const duplicadoGerado = encontrarSimilar(artigo.titulo, posts, artigo.resumo);
    if (duplicadoGerado) {
      return responderJson(res, 400, {
        ok: false,
        erro: `Matéria similar já existe: "${duplicadoGerado.titulo}"`
      });
    }

    responderJson(res, 200, {
      ok: true,
      artigo: { ...artigo, imagem, imagemAlt, topico: apurado },
      avisoImagem: imagem ? null : avisoFalhaImagem(),
      avisoQualidade: avisoQualidadeArtigo(artigo),
      palavras: artigo._palavras || null
    });
  } catch (e) {
    console.error('Erro preencher-formulario:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.use((err, req, res, next) => {
  console.error('Erro IA:', err);
  responderJson(res, 500, { ok: false, erro: err.message || 'Erro interno na IA' });
});

module.exports = router;
