const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const sequelize = require('../config/database');

const Post = sequelize.define('Post', {
  titulo: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  resumo: { type: DataTypes.TEXT, allowNull: true },
  conteudo: { type: DataTypes.TEXT('long'), allowNull: false },
  imagem: { type: DataTypes.STRING, allowNull: true },
  status: {
    type: DataTypes.ENUM('rascunho', 'publicado'),
    allowNull: false,
    defaultValue: 'rascunho'
  },
  destaque: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  publicadoEm: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'posts' });

Post.beforeValidate((post) => {
  if (post.titulo) post.slug = slugify(post.titulo, { lower: true, strict: true });
});

Post.beforeSave((post) => {
  if (post.status === 'publicado' && !post.publicadoEm) post.publicadoEm = new Date();
});

module.exports = Post;
