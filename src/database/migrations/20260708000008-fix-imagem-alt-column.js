'use strict';

/** Corrige coluna criada erroneamente como imagemAlt (camelCase) */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('posts');

    if (table.imagemAlt && !table.imagem_alt) {
      await queryInterface.renameColumn('posts', 'imagemAlt', 'imagem_alt');
      return;
    }

    if (!table.imagem_alt) {
      await queryInterface.addColumn('posts', 'imagem_alt', {
        type: Sequelize.STRING(500),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('posts');
    if (table.imagem_alt && !table.imagemAlt) {
      await queryInterface.renameColumn('posts', 'imagem_alt', 'imagemAlt');
    }
  }
};
