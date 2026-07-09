const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Comment = sequelize.define('Comment', {
  nome: { type: DataTypes.STRING(80), allowNull: false },
  email: { type: DataTypes.STRING(120), allowNull: false },
  conteudo: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('aprovado', 'pendente', 'rejeitado'),
    allowNull: false,
    defaultValue: 'aprovado'
  }
}, { tableName: 'comments' });

module.exports = Comment;
