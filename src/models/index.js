const sequelize = require('../config/database');
const User = require('./User');
const Category = require('./Category');
const Post = require('./Post');
const Page = require('./Page');

Post.belongsTo(Category, { foreignKey: 'categoriaId', as: 'categoria' });
Category.hasMany(Post, { foreignKey: 'categoriaId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'autorId', as: 'autor' });
User.hasMany(Post, { foreignKey: 'autorId', as: 'posts' });

module.exports = { sequelize, User, Category, Post, Page };
