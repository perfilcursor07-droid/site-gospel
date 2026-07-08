'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pages', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      titulo: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      conteudo: { type: Sequelize.TEXT('long'), allowNull: false },
      status: {
        type: Sequelize.ENUM('rascunho', 'publicado'),
        allowNull: false,
        defaultValue: 'publicado'
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pages');
  }
};
