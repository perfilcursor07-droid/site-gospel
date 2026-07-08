'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('categories', 'cor_hex', {
      type: Sequelize.STRING(7),
      allowNull: false,
      defaultValue: '#ea580c'
    });
    await queryInterface.addColumn('categories', 'ordem', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });
    await queryInterface.addColumn('posts', 'meta_title', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('posts', 'meta_description', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('categories', 'cor_hex');
    await queryInterface.removeColumn('categories', 'ordem');
    await queryInterface.removeColumn('posts', 'meta_title');
    await queryInterface.removeColumn('posts', 'meta_description');
  }
};
