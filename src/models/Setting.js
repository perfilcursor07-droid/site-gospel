const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Setting = sequelize.define('Setting', {
  chave: { type: DataTypes.STRING, allowNull: false, unique: true },
  valor: { type: DataTypes.TEXT, allowNull: true }
}, { tableName: 'settings' });

Setting.obterTodas = async function () {
  const linhas = await Setting.findAll();
  const config = {};
  linhas.forEach((linha) => { config[linha.chave] = linha.valor; });
  return config;
};

Setting.definir = async function (chave, valor) {
  const [linha, criada] = await Setting.findOrCreate({ where: { chave }, defaults: { valor } });
  if (!criada && linha.valor !== valor) {
    linha.valor = valor;
    await linha.save();
  }
  return linha;
};

module.exports = Setting;
