const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const sequelize = require('../config/database');

const Category = sequelize.define('Category', {
  nome: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  descricao: { type: DataTypes.TEXT, allowNull: true }
}, { tableName: 'categories' });

Category.beforeValidate((categoria) => {
  if (categoria.nome) categoria.slug = slugify(categoria.nome, { lower: true, strict: true });
});

module.exports = Category;
