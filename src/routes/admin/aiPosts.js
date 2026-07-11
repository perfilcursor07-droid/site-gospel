const router = require('express').Router();
const { Post } = require('../../models');
const { permitir } = require('../../middlewares/auth');
const { gerarArtigo } = require('../../services/deepseek');
const { pesquisarNichos, apurarTopico } = require('../../services/newsResearch');
const { obterImagemParaArtigo, avisoFalhaImagem } = require('../../services/imageFetcher');
const { marcarTopicosPublicados, deduplicarTopicos, encontrarSimilar, titulosSimilares } = require('../../utils/topicMatch');
const { agendarTopicos, prepararTopicosParaFila, obterResumoFila, listarErrosRecentesFila, limparErrosAntigosFila, cancelarFilaPendente, obterProximoSlotFila } = require('../../services/iaFilaPublicacao');
const {
  criarMonitor,
  listarMonitores,
  obterResumoMonitores,
  cancelarMonitor,
  pausarMonitor,
  retomarMonitor
} = require('../../services/iaMonitorAutomatico');
const {
  avaliarComprimento,
  mensagemAvisoQualidade,
  MIN_PALAVRAS_ARTIGO,
  MAX_PALAVRAS_ARTIGO
} = require('../../services/editorialGuidelines');
const { apurarPautaInvestigativa, artigoCitaNomesApurados, artigoRespeitaEvidencias } = require('../../services/investigativeResearch');

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

async function gerarArtigoCompleto(topico, nomeSite, opcoes = {}) {
  const apurado = await prepararTopico(topico);
  const conteudoInternacional = opcoes.conteudoInternacional === true
    || topico.fonteInternacional === true
    || topico.tipoFonte === 'internacional';

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
    redeSocial: apurado.redeSocial || apurado.tipoFonte === 'rede_social',
    conteudoInternacional
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
    const { palavrasChave, quantidadePorNicho, incluirRedesSociais, somenteRedesSociais, somenteRecentes, diasRecentes, conteudoInternacional, incluirGoogleTrends } = req.body;
    const somenteRedes = somenteRedesSociais === true || somenteRedesSociais === 'true';
    const internacional = conteudoInternacional === true || conteudoInternacional === 'true';
    const trends = incluirGoogleTrends !== false && incluirGoogleTrends !== 'false';
    const posts = await carregarPostsExistentes();
    const topicos = await pesquisarNichos(
      palavrasChave || 'gospel',
      Math.min(Math.max(parseInt(quantidadePorNicho, 10) || 5, 1), 10),
      {
        incluirRedesSociais: somenteRedes ? true : incluirRedesSociais !== false,
        somenteRedesSociais: somenteRedes,
        somenteRecentes: somenteRecentes !== false,
        diasRecentes: diasRecentes || '24h',
        conteudoInternacional: internacional,
        incluirGoogleTrends: somenteRedes ? false : trends,
        buscaAmpliada: somenteRedes || incluirRedesSociais !== false
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
    const { artigo, imagem, imagemAlt, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite, {
      conteudoInternacional: req.body.conteudoInternacional === true || req.body.conteudoInternacional === 'true' || topico.fonteInternacional
    });

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
    let ignoradosDuplicata = 0;
    let rascunhosSemImagem = 0;
    let textosCurtos = 0;
    let textosLongos = 0;
    const cacheTitulos = posts.map((p) => ({ id: p.id, titulo: p.titulo, slug: p.slug, resumo: p.resumo }));

    for (let i = 0; i < limite; i++) {
      const topico = topicosValidos[i];
      try {
        const duplicadoTopico = encontrarSimilar(topico.titulo, cacheTitulos, topico.resumo);
        if (duplicadoTopico) {
          ignoradosDuplicata += 1;
          continue;
        }

        const { artigo, imagem, imagemAlt } = await gerarArtigoCompleto(topico, nomeSite, {
          conteudoInternacional: topico.fonteInternacional || req.body.conteudoInternacional === true || req.body.conteudoInternacional === 'true'
        });

        const duplicadoGerado = encontrarSimilar(artigo.titulo, cacheTitulos, artigo.resumo);
        if (duplicadoGerado) {
          ignoradosDuplicata += 1;
          continue;
        }

        const statusFinal = statusComImagem(status, imagem);
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

        if (status === 'publicado' && !imagem) rascunhosSemImagem += 1;

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

    const totalIgnorados = ignorados + ignoradosDuplicata;

    responderJson(res, 200, {
      ok: true,
      criados,
      erros,
      ignorados: totalIgnorados,
      rascunhosSemImagem,
      textosCurtos,
      textosLongos,
      mensagem: `${criados.length} matéria(s) gerada(s)${totalIgnorados ? `, ${totalIgnorados} ignorada(s) (duplicada ou já publicada)` : ''}${rascunhosSemImagem ? `, ${rascunhosSemImagem} salva(s) como rascunho por falta de imagem` : ''}${textosCurtos ? `, ${textosCurtos} com texto curto (<${MIN_PALAVRAS_ARTIGO} palavras)` : ''}${textosLongos ? `, ${textosLongos} com texto longo (>${MAX_PALAVRAS_ARTIGO} palavras)` : ''}${erros.length ? `, ${erros.length} com erro` : ''}.`
    });
  } catch (e) {
    console.error('Erro gerar-lote:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/agendar-fila', async (req, res) => {
  try {
    const {
      topicos,
      categoriaId,
      status,
      minutosIntervalo,
      porLote,
      conteudoInternacional,
      modoInicio,
      inicioEm
    } = req.body;

    if (!Array.isArray(topicos) || !topicos.length) {
      return responderJson(res, 400, { ok: false, erro: 'Selecione ao menos um tópico.' });
    }

    const topicosValidos = await prepararTopicosParaFila(topicos);
    const ignorados = topicos.length - topicosValidos.length;

    if (!topicosValidos.length) {
      return responderJson(res, 400, {
        ok: false,
        erro: 'Todos os tópicos selecionados já foram publicados no site.'
      });
    }

    const limite = Math.min(topicosValidos.length, 100);
    const intervalo = Math.min(Math.max(parseInt(minutosIntervalo, 10) || 5, 1), 120);
    const lote = Math.min(Math.max(parseInt(porLote, 10) || 1, 1), 5);

    const resultado = await agendarTopicos({
      topicos: topicosValidos.slice(0, limite),
      autorId: req.session.user.id,
      categoriaId: categoriaId || null,
      statusDesejado: status === 'rascunho' ? 'rascunho' : 'publicado',
      minutosIntervalo: intervalo,
      porLote: lote,
      conteudoInternacional: conteudoInternacional === true || conteudoInternacional === 'true',
      modoInicio: ['agora', 'apos_fila', 'custom'].includes(modoInicio) ? modoInicio : 'agora',
      inicioEm: inicioEm || null
    });

    responderJson(res, 200, {
      ok: true,
      ignorados: ignorados + (topicosValidos.length - limite),
      agendados: resultado.total,
      primeiroEm: resultado.primeiroEm,
      ultimoEm: resultado.ultimoEm,
      mensagem: `${resultado.total} matéria(s) na fila. Você pode fechar esta página — o servidor gera e publica automaticamente nos intervalos definidos.`
    });
  } catch (e) {
    console.error('agendar-fila:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.get('/fila-proximo-slot', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : null;
    const minutos = Math.min(Math.max(parseInt(req.query.minutos, 10) || 5, 1), 120);
    const slot = await obterProximoSlotFila(autorId, minutos);
    responderJson(res, 200, { ok: true, ...slot });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.get('/fila-status', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : null;
    const resumo = await obterResumoFila(autorId);
    const errosRecentes = resumo.erros ? await listarErrosRecentesFila(autorId, 6) : [];
    responderJson(res, 200, { ok: true, ...resumo, errosRecentes });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.get('/fila-erros', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : null;
    const erros = await listarErrosRecentesFila(autorId, 15);
    responderJson(res, 200, { ok: true, erros });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/fila-limpar-erros', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : null;
    const qtd = await limparErrosAntigosFila(autorId, 7);
    responderJson(res, 200, { ok: true, limpos: qtd, mensagem: qtd ? `${qtd} erro(s) antigo(s) arquivado(s).` : 'Nenhum erro antigo para limpar.' });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/fila-cancelar', async (req, res) => {
  try {
    const qtd = await cancelarFilaPendente(req.session.user.id);
    responderJson(res, 200, { ok: true, cancelados: qtd });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

function opcoesBuscaDoBody(body) {
  const somenteRedes = body.somenteRedesSociais === true || body.somenteRedesSociais === 'true';
  return {
    incluirRedesSociais: somenteRedes ? true : body.incluirRedesSociais !== false,
    somenteRedesSociais: somenteRedes,
    somenteRecentes: true,
    diasRecentes: body.diasRecentes || '24h',
    conteudoInternacional: body.conteudoInternacional === true || body.conteudoInternacional === 'true',
    incluirGoogleTrends: somenteRedes ? false : body.incluirGoogleTrends !== false,
    buscaAmpliada: true
  };
}

function serializarMonitor(m) {
  return {
    id: m.id,
    palavrasChave: m.palavrasChave,
    categoriaId: m.categoriaId,
    statusDesejado: m.statusDesejado,
    quantidadePorCiclo: m.quantidadePorCiclo,
    minutosIntervalo: m.minutosIntervalo,
    inicioEm: m.inicioEm,
    fimEm: m.fimEm,
    proximaExecucao: m.proximaExecucao,
    ultimaBuscaEm: m.ultimaBuscaEm,
    totalPublicados: m.totalPublicados,
    status: m.status,
    ultimoErro: m.ultimoErro,
    conteudoInternacional: m.conteudoInternacional
  };
}

router.post('/monitor-criar', async (req, res) => {
  try {
    const {
      palavrasChave,
      categoriaId,
      status,
      quantidadePorCiclo,
      minutosIntervalo,
      inicioEm,
      fimEm,
      conteudoInternacional
    } = req.body;

    const monitor = await criarMonitor({
      autorId: req.session.user.id,
      categoriaId: categoriaId || null,
      palavrasChave,
      statusDesejado: status === 'rascunho' ? 'rascunho' : 'publicado',
      conteudoInternacional: conteudoInternacional === true || conteudoInternacional === 'true',
      opcoesBusca: opcoesBuscaDoBody(req.body),
      quantidadePorCiclo,
      minutosIntervalo,
      inicioEm: inicioEm || null,
      fimEm: fimEm || null
    });

    responderJson(res, 200, {
      ok: true,
      monitor: serializarMonitor(monitor),
      mensagem: 'Automação ativa! O servidor busca assuntos recentes e publica nos intervalos definidos — pode fechar esta página.'
    });
  } catch (e) {
    responderJson(res, 400, { ok: false, erro: e.message });
  }
});

router.get('/monitor-lista', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : req.session.user.id;
    const monitores = await listarMonitores(autorId);
    responderJson(res, 200, {
      ok: true,
      monitores: monitores.map(serializarMonitor)
    });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.get('/monitor-status', async (req, res) => {
  try {
    const autorId = req.session.user.papel === 'usuario' ? req.session.user.id : req.session.user.id;
    const resumo = await obterResumoMonitores(autorId);
    responderJson(res, 200, { ok: true, ...resumo });
  } catch (e) {
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.post('/monitor-cancelar', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return responderJson(res, 400, { ok: false, erro: 'ID do monitor inválido.' });
    await cancelarMonitor(parseInt(id, 10), req.session.user.id);
    responderJson(res, 200, { ok: true, mensagem: 'Automação cancelada.' });
  } catch (e) {
    responderJson(res, 400, { ok: false, erro: e.message });
  }
});

router.post('/monitor-pausar', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return responderJson(res, 400, { ok: false, erro: 'ID do monitor inválido.' });
    await pausarMonitor(parseInt(id, 10), req.session.user.id);
    responderJson(res, 200, { ok: true, mensagem: 'Automação pausada.' });
  } catch (e) {
    responderJson(res, 400, { ok: false, erro: e.message });
  }
});

router.post('/monitor-retomar', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return responderJson(res, 400, { ok: false, erro: 'ID do monitor inválido.' });
    await retomarMonitor(parseInt(id, 10), req.session.user.id);
    responderJson(res, 200, { ok: true, mensagem: 'Automação retomada.' });
  } catch (e) {
    responderJson(res, 400, { ok: false, erro: e.message });
  }
});

router.post('/preencher-formulario', async (req, res) => {
  try {
    const { palavrasChave, incluirRedesSociais } = req.body;
    const somenteRedes = req.body.somenteRedesSociais === true || req.body.somenteRedesSociais === 'true';
    const internacional = req.body.conteudoInternacional === true || req.body.conteudoInternacional === 'true';
    const topicos = await pesquisarNichos(palavrasChave || 'gospel', 1, {
      incluirRedesSociais: somenteRedes ? true : req.body.incluirRedesSociais !== false,
      somenteRedesSociais: somenteRedes,
      somenteRecentes: req.body.somenteRecentes !== false,
      diasRecentes: req.body.diasRecentes || '24h',
      conteudoInternacional: internacional,
      incluirGoogleTrends: !somenteRedes && req.body.incluirGoogleTrends !== false
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

    const { artigo, imagem, imagemAlt, topico: apurado } = await gerarArtigoCompleto(topico, nomeSite, {
      conteudoInternacional: req.body.conteudoInternacional === true || req.body.conteudoInternacional === 'true' || topico.fonteInternacional
    });

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

router.post('/investigativa/gerar', async (req, res) => {
  try {
    const { palavrasChave, categoriaId, diasRecentes, conteudoInternacional } = req.body;
    const nomeSite = res.locals.config?.site_nome || 'Site Gospel';

    const pauta = await apurarPautaInvestigativa(palavrasChave, {
      diasRecentes: diasRecentes || '7',
      conteudoInternacional: conteudoInternacional !== false && conteudoInternacional !== 'false',
      incluirRedesSociais: true
    });

    const posts = await carregarPostsExistentes();

    const artigo = await gerarArtigo({
      tituloReferencia: pauta.titulo,
      resumoReferencia: pauta.resumo,
      fonte: pauta.link,
      nicho: pauta.nicho,
      nomeSite,
      contextoApuracao: pauta.contextoApuracao,
      fontesApuracao: pauta.fontesApuracao,
      redeSocial: pauta.redeSocial,
      conteudoInternacional: pauta.fonteInternacional,
      investigativa: true,
      palavrasChaveInvestigativa: pauta.palavrasChave,
      formatoInvestigativa: pauta.formatoInvestigativa,
      nomesApurados: pauta.nomesApurados,
      evidenciasVerificadas: pauta.evidenciasVerificadas
    });

    if (pauta.formatoInvestigativa === 'listagem_nomes' && !artigoRespeitaEvidencias(artigo, pauta.evidenciasVerificadas)) {
      return responderJson(res, 400, {
        ok: false,
        erro: 'A matéria incluiu pessoas sem prova documentada na apuração. Geração bloqueada — tente novamente.'
      });
    }

    if (pauta.formatoInvestigativa === 'listagem_nomes' && !artigoCitaNomesApurados(artigo, pauta.nomesApurados)) {
      return responderJson(res, 400, {
        ok: false,
        erro: `A IA não incluiu os nomes confirmados na apuração (${pauta.nomesApurados.join(', ')}). Tente novamente ou refine as palavras-chave.`
      });
    }

    const duplicadoGerado = posts.find((p) => titulosSimilares(p.titulo, artigo.titulo));
    if (duplicadoGerado) {
      return responderJson(res, 400, {
        ok: false,
        erro: `Já existe matéria com manchete parecida: "${duplicadoGerado.titulo}". Edite o rascunho existente ou refine as palavras-chave.`
      });
    }

    const post = await Post.create({
      titulo: artigo.titulo,
      resumo: artigo.resumo,
      conteudo: artigo.conteudo,
      categoriaId: categoriaId || null,
      autorId: req.session.user.id,
      status: 'rascunho',
      destaque: false,
      metaTitle: artigo.meta_title || null,
      metaDescription: artigo.meta_description || null,
      imagem: null,
      imagemAlt: null
    });

    responderJson(res, 200, {
      ok: true,
      post: {
        id: post.id,
        titulo: post.titulo,
        slug: post.slug,
        status: post.status
      },
      fontes: pauta.fontesResumo,
      contagemFontes: pauta.contagemFontes,
      nomesApurados: pauta.nomesApurados,
      evidencias: (pauta.evidenciasVerificadas || []).map((e) => ({
        nome: e.nome,
        url: e.url,
        veiculo: e.veiculo
      })),
      avisoQualidade: avisoQualidadeArtigo(artigo),
      palavras: artigo._palavras || null,
      mensagem: `Matéria investigativa salva como rascunho. Adicione a imagem de capa antes de publicar.${pauta.contagemFontes ? ` Apuradas ${pauta.contagemFontes} fontes.` : ''}`
    });
  } catch (e) {
    console.error('Erro investigativa/gerar:', e);
    responderJson(res, 500, { ok: false, erro: e.message });
  }
});

router.use((err, req, res, next) => {
  console.error('Erro IA:', err);
  responderJson(res, 500, { ok: false, erro: err.message || 'Erro interno na IA' });
});

module.exports = router;
