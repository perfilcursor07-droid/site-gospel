const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const sequelize = require('../config/database');

const Post = sequelize.define('Post', {
  titulo: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  resumo: { type: DataTypes.TEXT, allowNull: true },
  conteudo: { type: DataTypes.TEXT('long'), allowNull: false },
  imagem: { type: DataTypes.STRING, allowNull: true },
  imagemAlt: { type: DataTypes.STRING(500), allowNull: true },
  status: {
    type: DataTypes.ENUM('rascunho', 'publicado'),
    allowNull: false,
    defaultValue: 'rascunho'
  },
  destaque: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  metaTitle: { type: DataTypes.STRING, allowNull: true },
  metaDescription: { type: DataTypes.STRING, allowNull: true },
  publicadoEm: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'posts' });

// Slug editável: usa o slug informado ou gera a partir do título
Post.beforeValidate((post) => {
  const base = (post.slug && post.slug.trim()) ? post.slug : post.titulo;
  if (base) post.slug = slugify(base, { lower: true, strict: true });
});

Post.beforeSave((post) => {
  if (post.status === 'publicado' && !post.publicadoEm) post.publicadoEm = new Date();
});

module.exports = Post;
