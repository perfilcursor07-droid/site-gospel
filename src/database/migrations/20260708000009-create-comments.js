'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('comments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      post_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'posts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      nome: { type: Sequelize.STRING(80), allowNull: false },
      email: { type: Sequelize.STRING(120), allowNull: false },
      conteudo: { type: Sequelize.TEXT, allowNull: false },
      status: {
        type: Sequelize.ENUM('aprovado', 'pendente', 'rejeitado'),
        allowNull: false,
        defaultValue: 'aprovado'
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('comments', ['post_id']);
    await queryInterface.addIndex('comments', ['status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('comments');
  }
};
