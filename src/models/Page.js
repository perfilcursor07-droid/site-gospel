const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const sequelize = require('../config/database');

const Page = sequelize.define('Page', {
  titulo: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  conteudo: { type: DataTypes.TEXT('long'), allowNull: false },
  status: {
    type: DataTypes.ENUM('rascunho', 'publicado'),
    allowNull: false,
    defaultValue: 'publicado'
  }
}, { tableName: 'pages' });

Page.beforeValidate((page) => {
  if (page.titulo) page.slug = slugify(page.titulo, { lower: true, strict: true });
});

module.exports = Page;
