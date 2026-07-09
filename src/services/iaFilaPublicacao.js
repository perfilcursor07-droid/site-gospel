const { Op } = require('sequelize');
const { Post, IaFilaJob } = require('../models');
const { gerarArtigo } = require('./deepseek');
const { apurarTopico } = require('./articleSource');
const { obterImagemParaArtigo } = require('./imageFetcher');
const { encontrarSimilar, marcarTopicosPublicados, deduplicarTopicos } = require('../utils/topicMatch');

let processando = false;

function statusComImagem(statusDesejado, imagem, publicarEm) {
  if (statusDesejado !== 'publicado') return 'rascunho';
  if (!imagem) return 'rascunho';
  if (publicarEm && new Date(publicarEm) > new Date()) return 'agendado';
  return 'publicado';
}

async function gerarPostDoTopico(topico, { autorId, categoriaId, statusDesejado, publicarEm, nomeSite, conteudoInternacional }) {
  const apurado = await apurarTopico(topico);
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
    conteudoInternacional: conteudoInternacional || topico.fonteInternacional
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

  const imagem = capa?.imagem || null;
  const statusFinal = statusComImagem(statusDesejado, imagem, publicarEm);

  const post = await Post.create({
    titulo: artigo.titulo,
    resumo: artigo.resumo,
    conteudo: artigo.conteudo,
    categoriaId: categoriaId || null,
    autorId,
    status: statusFinal,
    destaque: false,
    metaTitle: artigo.meta_title || null,
    metaDescription: artigo.meta_description || null,
    imagem,
    imagemAlt: capa?.alt || null,
    publicadoEm: statusFinal === 'agendado' ? publicarEm : (statusFinal === 'publicado' ? new Date() : null)
  });

  return { post, artigo, semImagem: !imagem };
}

async function agendarTopicos({
  topicos,
  autorId,
  categoriaId,
  statusDesejado = 'publicado',
  minutosIntervalo = 5,
  porLote = 1,
  conteudoInternacional = false,
  modoInicio = 'agora',
  inicioEm = null
}) {
  const msIntervalo = Math.max(minutosIntervalo, 1) * 60 * 1000;
  const lote = Math.max(porLote, 1);
  const baseMs = await calcularInicioAgendamento({ autorId, modoInicio, inicioEm, msIntervalo });

  const maxOrdem = await IaFilaJob.max('ordem', {
    where: { status: ['pendente', 'processando'] }
  }) || 0;

  const jobs = [];

  for (let i = 0; i < topicos.length; i++) {
    const indiceLote = Math.floor(i / lote);
    const executarApos = new Date(baseMs + indiceLote * msIntervalo);
    const publicarEm = new Date(executarApos);

    jobs.push({
      autorId,
      categoriaId: categoriaId || null,
      topico: JSON.stringify(topicos[i]),
      statusDesejado: statusDesejado === 'publicado' ? 'publicado' : 'rascunho',
      conteudoInternacional: !!conteudoInternacional,
      ordem: maxOrdem + i + 1,
      executarApos,
      publicarEm,
      status: 'pendente'
    });
  }

  await IaFilaJob.bulkCreate(jobs);
  return { total: jobs.length, primeiroEm: jobs[0]?.executarApos, ultimoEm: jobs[jobs.length - 1]?.publicarEm };
}

async function calcularInicioAgendamento({ autorId, modoInicio, inicioEm, msIntervalo }) {
  const agora = Date.now();

  if (modoInicio === 'custom' && inicioEm) {
    const custom = new Date(inicioEm).getTime();
    if (!Number.isNaN(custom)) return Math.max(agora, custom);
  }

  if (modoInicio === 'apos_fila') {
    const where = autorId ? { autorId } : {};
    const [ultimoJob, ultimoPost] = await Promise.all([
      IaFilaJob.findOne({
        where: { ...where, status: ['pendente', 'processando'] },
        order: [['publicarEm', 'DESC']]
      }),
      Post.findOne({
        where: { ...where, status: 'agendado' },
        order: [['publicadoEm', 'DESC']]
      })
    ]);

    let fim = agora;
    if (ultimoJob?.publicarEm) fim = Math.max(fim, new Date(ultimoJob.publicarEm).getTime());
    if (ultimoPost?.publicadoEm) fim = Math.max(fim, new Date(ultimoPost.publicadoEm).getTime());
    return fim + msIntervalo;
  }

  return agora;
}

async function obterProximoSlotFila(autorId = null, minutosIntervalo = 5) {
  const where = autorId ? { autorId } : {};
  const msIntervalo = Math.max(minutosIntervalo, 1) * 60 * 1000;

  const [ultimoJob, ultimoPost] = await Promise.all([
    IaFilaJob.findOne({
      where: { ...where, status: ['pendente', 'processando'] },
      order: [['publicarEm', 'DESC']]
    }),
    Post.findOne({
      where: { ...where, status: 'agendado' },
      order: [['publicadoEm', 'DESC']]
    })
  ]);

  const agora = Date.now();
  let fim = agora;
  if (ultimoJob?.publicarEm) fim = Math.max(fim, new Date(ultimoJob.publicarEm).getTime());
  if (ultimoPost?.publicadoEm) fim = Math.max(fim, new Date(ultimoPost.publicadoEm).getTime());

  return {
    ultimoFila: ultimoJob?.publicarEm || null,
    ultimoAgendado: ultimoPost?.publicadoEm || null,
    sugeridoAposFila: new Date(fim + msIntervalo),
    temFilaAtiva: !!(ultimoJob || ultimoPost)
  };
}

async function recuperarJobsTravados() {
  const [qtd] = await IaFilaJob.update(
    { status: 'pendente' },
    { where: { status: 'processando' } }
  );
  if (qtd) console.log(`iaFila: ${qtd} job(s) em processamento recuperado(s) após reinício.`);
  return qtd;
}

async function publicarPostsAgendados() {
  const agora = new Date();
  const [qtd] = await Post.update(
    { status: 'publicado' },
    {
      where: {
        status: 'agendado',
        publicadoEm: { [Op.lte]: agora },
        imagem: { [Op.ne]: null }
      }
    }
  );
  return qtd;
}

async function processarProximoJob(nomeSite = 'Site Gospel') {
  if (processando) return null;

  const job = await IaFilaJob.findOne({
    where: {
      status: 'pendente',
      executarApos: { [Op.lte]: new Date() }
    },
    order: [['ordem', 'ASC'], ['executarApos', 'ASC']]
  });

  if (!job) return null;

  processando = true;
  await job.update({ status: 'processando' });

  try {
    const topico = JSON.parse(job.topico);
    const existentes = await Post.findAll({
      attributes: ['id', 'titulo', 'slug', 'resumo'],
      where: { status: ['publicado', 'rascunho', 'agendado'] }
    });

    const duplicado = encontrarSimilar(topico.titulo, existentes, topico.resumo);
    if (duplicado) {
      await job.update({
        status: 'erro',
        erro: `Assunto similar já existe: "${duplicado.titulo}"`
      });
      return { job, erro: job.erro };
    }

    const { post } = await gerarPostDoTopico(topico, {
      autorId: job.autorId,
      categoriaId: job.categoriaId,
      statusDesejado: job.statusDesejado,
      publicarEm: job.publicarEm,
      nomeSite,
      conteudoInternacional: job.conteudoInternacional
    });

    const duplicadoGerado = encontrarSimilar(post.titulo, existentes, post.resumo);
    if (duplicadoGerado) {
      await post.destroy();
      await job.update({
        status: 'erro',
        erro: `Matéria gerada similar a: "${duplicadoGerado.titulo}"`
      });
      return { job, erro: job.erro };
    }

    await job.update({ status: 'concluido', postId: post.id });
    await publicarPostsAgendados();
    return { job, post };
  } catch (e) {
    console.error('iaFilaPublicacao job', job.id, e.message);
    await job.update({ status: 'erro', erro: e.message?.slice(0, 500) || 'Erro desconhecido' });
    return { job, erro: e.message };
  } finally {
    processando = false;
  }
}

async function obterResumoFila(autorId = null) {
  const where = autorId ? { autorId } : {};
  const [pendentes, processandoQtd, concluidos, erros] = await Promise.all([
    IaFilaJob.count({ where: { ...where, status: 'pendente' } }),
    IaFilaJob.count({ where: { ...where, status: 'processando' } }),
    IaFilaJob.count({ where: { ...where, status: 'concluido' } }),
    IaFilaJob.count({ where: { ...where, status: 'erro' } })
  ]);
  return { pendentes, processando: processandoQtd, concluidos, erros, ativo: pendentes > 0 || processandoQtd > 0 };
}

async function cancelarFilaPendente(autorId) {
  const [qtd] = await IaFilaJob.update(
    { status: 'cancelado' },
    { where: { autorId, status: 'pendente' } }
  );
  return qtd;
}

async function tickFila(nomeSite) {
  await publicarPostsAgendados();
  if (processando) return;
  await processarProximoJob(nomeSite);
}

module.exports = {
  agendarTopicos,
  processarProximoJob,
  publicarPostsAgendados,
  obterResumoFila,
  cancelarFilaPendente,
  tickFila,
  calcularInicioAgendamento,
  obterProximoSlotFila,
  recuperarJobsTravados,
  prepararTopicosParaFila: async (topicos) => {
    const posts = await Post.findAll({
      attributes: ['id', 'titulo', 'slug', 'resumo', 'status'],
      where: { status: ['publicado', 'rascunho', 'agendado'] }
    });
    const unicos = deduplicarTopicos(topicos);
    return marcarTopicosPublicados(unicos, posts).filter((t) => !t.jaPublicado);
  }
};
