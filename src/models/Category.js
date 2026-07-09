const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const sequelize = require('../config/database');

const Category = sequelize.define('Category', {
  nome: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  descricao: { type: DataTypes.TEXT, allowNull: true },
  corHex: { type: DataTypes.STRING(7), allowNull: false, defaultValue: '#ea580c' },
  ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, { tableName: 'categories' });

Category.beforeValidate((categoria) => {
  const base = (categoria.slug && String(categoria.slug).trim()) ? categoria.slug : categoria.nome;
  if (base) categoria.slug = slugify(base, { lower: true, strict: true });
});

module.exports = Category;
