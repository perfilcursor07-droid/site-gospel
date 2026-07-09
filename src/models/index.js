const sequelize = require('../config/database');
const User = require('./User');
const Category = require('./Category');
const Post = require('./Post');
const Page = require('./Page');
const Setting = require('./Setting');
const Comment = require('./Comment');

Post.belongsTo(Category, { foreignKey: 'categoriaId', as: 'categoria' });
Category.hasMany(Post, { foreignKey: 'categoriaId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'autorId', as: 'autor' });
User.hasMany(Post, { foreignKey: 'autorId', as: 'posts' });
Comment.belongsTo(Post, { foreignKey: 'postId', as: 'post' });
Post.hasMany(Comment, { foreignKey: 'postId', as: 'comentarios' });

module.exports = { sequelize, User, Category, Post, Page, Setting, Comment };
