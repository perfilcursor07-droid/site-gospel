'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('posts', 'imagem_alt', {
      type: Sequelize.STRING(500),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('posts', 'imagem_alt');
  }
};
