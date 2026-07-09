const { Op } = require('sequelize');
const { IaMonitorAuto } = require('../models');
const { pesquisarNichos } = require('./newsResearch');
const { agendarTopicos, prepararTopicosParaFila } = require('./iaFilaPublicacao');

let processandoMonitores = false;

function parseOpcoesBusca(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function normalizarOpcoesBusca(opcoes = {}) {
  return {
    incluirRedesSociais: opcoes.incluirRedesSociais !== false,
    somenteRedesSociais: opcoes.somenteRedesSociais === true,
    somenteRecentes: true,
    diasRecentes: opcoes.diasRecentes || '24h',
    conteudoInternacional: opcoes.conteudoInternacional === true,
    incluirGoogleTrends: opcoes.incluirGoogleTrends !== false && !opcoes.somenteRedesSociais,
    buscaAmpliada: true
  };
}

async function criarMonitor({
  autorId,
  categoriaId,
  palavrasChave,
  statusDesejado = 'publicado',
  conteudoInternacional = false,
  opcoesBusca = {},
  quantidadePorCiclo = 1,
  minutosIntervalo = 30,
  inicioEm,
  fimEm
}) {
  const palavras = String(palavrasChave || '').trim();
  if (!palavras) throw new Error('Informe ao menos uma palavra-chave para monitorar.');

  const inicio = inicioEm ? new Date(inicioEm) : new Date();
  if (Number.isNaN(inicio.getTime())) throw new Error('Data de início inválida.');

  const fim = fimEm ? new Date(fimEm) : null;
  if (fim && Number.isNaN(fim.getTime())) throw new Error('Data de fim inválida.');
  if (fim && fim <= inicio) throw new Error('A data de fim deve ser posterior ao início.');

  const agora = new Date();
  const proximaExecucao = inicio > agora ? inicio : agora;

  return IaMonitorAuto.create({
    autorId,
    categoriaId: categoriaId || null,
    palavrasChave: palavras.slice(0, 500),
    statusDesejado: statusDesejado === 'rascunho' ? 'rascunho' : 'publicado',
    conteudoInternacional: !!conteudoInternacional,
    opcoesBusca: JSON.stringify(normalizarOpcoesBusca(opcoesBusca)),
    quantidadePorCiclo: Math.min(Math.max(parseInt(quantidadePorCiclo, 10) || 1, 1), 5),
    minutosIntervalo: Math.min(Math.max(parseInt(minutosIntervalo, 10) || 30, 5), 720),
    inicioEm: inicio,
    fimEm: fim,
    proximaExecucao,
    status: 'ativo',
    totalPublicados: 0
  });
}

async function processarMonitor(monitor) {
  const agora = new Date();

  if (monitor.fimEm && agora > monitor.fimEm) {
    await monitor.update({ status: 'concluido', ultimoErro: null });
    return { monitor, concluido: true };
  }

  if (monitor.inicioEm > agora) {
    return { monitor, aguardando: true };
  }

  const opcoes = normalizarOpcoesBusca(parseOpcoesBusca(monitor.opcoesBusca));
  const qtd = monitor.quantidadePorCiclo;
  const buscaQtd = Math.min(Math.max(qtd + (opcoes.buscaAmpliada ? 8 : 3), 8), 15);

  const topicos = await pesquisarNichos(monitor.palavrasChave, buscaQtd, {
    ...opcoes,
    conteudoInternacional: monitor.conteudoInternacional || opcoes.conteudoInternacional
  });

  const novos = await prepararTopicosParaFila(topicos);
  const selecionados = novos.slice(0, qtd);

  let agendados = 0;
  if (selecionados.length) {
    const intervaloPosts = Math.max(3, Math.floor(monitor.minutosIntervalo / Math.max(qtd, 1)));
    const resultado = await agendarTopicos({
      topicos: selecionados,
      autorId: monitor.autorId,
      categoriaId: monitor.categoriaId,
      statusDesejado: monitor.statusDesejado,
      minutosIntervalo: intervaloPosts,
      porLote: 1,
      conteudoInternacional: monitor.conteudoInternacional,
      modoInicio: 'agora'
    });
    agendados = resultado.total;
  }

  const proximaExecucao = new Date(Date.now() + monitor.minutosIntervalo * 60 * 1000);
  const updates = {
    ultimaBuscaEm: agora,
    ultimoErro: selecionados.length ? null : 'Nenhum assunto novo recente neste ciclo.',
    proximaExecucao,
    totalPublicados: monitor.totalPublicados + agendados
  };

  if (monitor.fimEm && proximaExecucao >= monitor.fimEm) {
    updates.status = 'concluido';
  }

  await monitor.update(updates);
  return { monitor, agendados, semNovos: !selecionados.length };
}

async function tickMonitores() {
  if (processandoMonitores) return null;
  processandoMonitores = true;

  try {
    const agora = new Date();
    const monitores = await IaMonitorAuto.findAll({
      where: {
        status: 'ativo',
        proximaExecucao: { [Op.lte]: agora },
        inicioEm: { [Op.lte]: agora },
        [Op.or]: [
          { fimEm: null },
          { fimEm: { [Op.gte]: agora } }
        ]
      },
      order: [['proximaExecucao', 'ASC']],
      limit: 3
    });

    const resultados = [];
    for (const monitor of monitores) {
      try {
        resultados.push(await processarMonitor(monitor));
      } catch (e) {
        console.error('iaMonitorAuto', monitor.id, e.message);
        const proximaExecucao = new Date(Date.now() + monitor.minutosIntervalo * 60 * 1000);
        await monitor.update({
          ultimoErro: e.message?.slice(0, 500) || 'Erro desconhecido',
          proximaExecucao,
          status: monitor.fimEm && proximaExecucao >= monitor.fimEm ? 'concluido' : 'ativo'
        });
        resultados.push({ monitor, erro: e.message });
      }
    }
    return resultados;
  } finally {
    processandoMonitores = false;
  }
}

async function listarMonitores(autorId = null, { apenasAtivos = false } = {}) {
  const where = {};
  if (autorId) where.autorId = autorId;
  if (apenasAtivos) where.status = 'ativo';

  return IaMonitorAuto.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: 50
  });
}

async function obterResumoMonitores(autorId = null) {
  const where = autorId ? { autorId } : {};
  const ativos = await IaMonitorAuto.count({ where: { ...where, status: 'ativo' } });
  return { ativos, temAtivos: ativos > 0 };
}

async function cancelarMonitor(id, autorId) {
  const monitor = await IaMonitorAuto.findOne({ where: { id, autorId } });
  if (!monitor) throw new Error('Monitor não encontrado.');
  if (monitor.status === 'cancelado' || monitor.status === 'concluido') {
    return monitor;
  }
  await monitor.update({ status: 'cancelado', ultimoErro: null });
  return monitor;
}

async function pausarMonitor(id, autorId) {
  const monitor = await IaMonitorAuto.findOne({ where: { id, autorId, status: 'ativo' } });
  if (!monitor) throw new Error('Monitor ativo não encontrado.');
  await monitor.update({ status: 'pausado' });
  return monitor;
}

async function retomarMonitor(id, autorId) {
  const monitor = await IaMonitorAuto.findOne({ where: { id, autorId, status: 'pausado' } });
  if (!monitor) throw new Error('Monitor pausado não encontrado.');
  await monitor.update({
    status: 'ativo',
    proximaExecucao: new Date(),
    ultimoErro: null
  });
  return monitor;
}

module.exports = {
  criarMonitor,
  tickMonitores,
  listarMonitores,
  obterResumoMonitores,
  cancelarMonitor,
  pausarMonitor,
  retomarMonitor,
  processarMonitor
};
