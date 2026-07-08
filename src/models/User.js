const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  nome: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  senha: { type: DataTypes.STRING, allowNull: false },
  papel: {
    type: DataTypes.ENUM('administrador', 'gestor', 'usuario'),
    allowNull: false,
    defaultValue: 'usuario'
  }
}, { tableName: 'users' });

User.beforeCreate(async (user) => {
  user.senha = await bcrypt.hash(user.senha, 10);
});

User.beforeUpdate(async (user) => {
  if (user.changed('senha')) user.senha = await bcrypt.hash(user.senha, 10);
});

User.prototype.verificarSenha = function (senha) {
  return bcrypt.compare(senha, this.senha);
};

module.exports = User;
