const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IaMonitorAuto = sequelize.define('IaMonitorAuto', {
  autorId: { type: DataTypes.INTEGER, allowNull: false },
  categoriaId: { type: DataTypes.INTEGER, allowNull: true },
  palavrasChave: { type: DataTypes.STRING(500), allowNull: false },
  statusDesejado: {
    type: DataTypes.ENUM('rascunho', 'publicado'),
    allowNull: false,
    defaultValue: 'publicado'
  },
  conteudoInternacional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  opcoesBusca: { type: DataTypes.TEXT('long'), allowNull: true },
  quantidadePorCiclo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  minutosIntervalo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
  inicioEm: { type: DataTypes.DATE, allowNull: false },
  fimEm: { type: DataTypes.DATE, allowNull: true },
  proximaExecucao: { type: DataTypes.DATE, allowNull: false },
  ultimaBuscaEm: { type: DataTypes.DATE, allowNull: true },
  totalPublicados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.ENUM('ativo', 'pausado', 'concluido', 'cancelado'),
    allowNull: false,
    defaultValue: 'ativo'
  },
  ultimoErro: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'ia_monitor_auto',
  indexes: [
    { fields: ['status', 'proximaExecucao'] },
    { fields: ['autorId', 'status'] }
  ]
});

module.exports = IaMonitorAuto;
