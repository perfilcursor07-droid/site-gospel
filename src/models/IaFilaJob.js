const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IaFilaJob = sequelize.define('IaFilaJob', {
  autorId: { type: DataTypes.INTEGER, allowNull: false },
  categoriaId: { type: DataTypes.INTEGER, allowNull: true },
  topico: { type: DataTypes.TEXT('long'), allowNull: false },
  statusDesejado: {
    type: DataTypes.ENUM('rascunho', 'publicado'),
    allowNull: false,
    defaultValue: 'publicado'
  },
  conteudoInternacional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  executarApos: { type: DataTypes.DATE, allowNull: false },
  publicarEm: { type: DataTypes.DATE, allowNull: false },
  status: {
    type: DataTypes.ENUM('pendente', 'processando', 'concluido', 'erro', 'cancelado'),
    allowNull: false,
    defaultValue: 'pendente'
  },
  postId: { type: DataTypes.INTEGER, allowNull: true },
  erro: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'ia_fila_jobs',
  indexes: [
    { fields: ['status', 'executarApos'] },
    { fields: ['autorId', 'status'] }
  ]
});

module.exports = IaFilaJob;
