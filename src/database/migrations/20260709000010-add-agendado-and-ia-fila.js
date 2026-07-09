'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('posts', 'status', {
      type: Sequelize.ENUM('rascunho', 'publicado', 'agendado'),
      allowNull: false,
      defaultValue: 'rascunho'
    });

    await queryInterface.createTable('ia_fila_jobs', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      autor_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      categoria_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      topico: { type: Sequelize.TEXT('long'), allowNull: false },
      status_desejado: {
        type: Sequelize.ENUM('rascunho', 'publicado'),
        allowNull: false,
        defaultValue: 'publicado'
      },
      conteudo_internacional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      ordem: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      executar_apos: { type: Sequelize.DATE, allowNull: false },
      publicar_em: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('pendente', 'processando', 'concluido', 'erro', 'cancelado'),
        allowNull: false,
        defaultValue: 'pendente'
      },
      post_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'posts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      erro: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex('ia_fila_jobs', ['status', 'executar_apos']);
    await queryInterface.addIndex('ia_fila_jobs', ['autor_id', 'status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('ia_fila_jobs');
    await queryInterface.sequelize.query(
      "UPDATE posts SET status = 'rascunho' WHERE status = 'agendado'"
    );
    await queryInterface.changeColumn('posts', 'status', {
      type: Sequelize.ENUM('rascunho', 'publicado'),
      allowNull: false,
      defaultValue: 'rascunho'
    });
  }
};
