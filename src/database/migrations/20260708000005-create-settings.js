'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('settings', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      chave: { type: Sequelize.STRING, allowNull: false, unique: true },
      valor: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settings');
  }
};
