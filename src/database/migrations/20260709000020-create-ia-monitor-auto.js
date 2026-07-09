'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ia_monitor_auto', {
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
      palavras_chave: { type: Sequelize.STRING(500), allowNull: false },
      status_desejado: {
        type: Sequelize.ENUM('rascunho', 'publicado'),
        allowNull: false,
        defaultValue: 'publicado'
      },
      conteudo_internacional: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      opcoes_busca: { type: Sequelize.TEXT('long'), allowNull: true },
      quantidade_por_ciclo: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      minutos_intervalo: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      inicio_em: { type: Sequelize.DATE, allowNull: false },
      fim_em: { type: Sequelize.DATE, allowNull: true },
      proxima_execucao: { type: Sequelize.DATE, allowNull: false },
      ultima_busca_em: { type: Sequelize.DATE, allowNull: true },
      total_publicados: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM('ativo', 'pausado', 'concluido', 'cancelado'),
        allowNull: false,
        defaultValue: 'ativo'
      },
      ultimo_erro: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex('ia_monitor_auto', ['status', 'proxima_execucao']);
    await queryInterface.addIndex('ia_monitor_auto', ['autor_id', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ia_monitor_auto');
  }
};
