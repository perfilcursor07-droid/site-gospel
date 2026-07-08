'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('posts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      titulo: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      resumo: { type: Sequelize.TEXT, allowNull: true },
      conteudo: { type: Sequelize.TEXT('long'), allowNull: false },
      imagem: { type: Sequelize.STRING, allowNull: true },
      status: {
        type: Sequelize.ENUM('rascunho', 'publicado'),
        allowNull: false,
        defaultValue: 'rascunho'
      },
      destaque: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      publicado_em: { type: Sequelize.DATE, allowNull: true },
      categoria_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      autor_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('posts');
  }
};
