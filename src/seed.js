require('dotenv').config();
const { sequelize, User, Category, Post, Page } = require('./models');

(async () => {
  try {
    await sequelize.authenticate();

    const [admin] = await User.findOrCreate({
      where: { email: 'admin@sitegospel.com' },
      defaults: { nome: 'Administrador', senha: 'admin123', papel: 'administrador' }
    });

    const nomes = ['Louvor', 'Estudos Bíblicos', 'Eventos', 'Devocionais'];
    const categorias = [];
    for (const nome of nomes) {
      const [cat] = await Category.findOrCreate({ where: { nome } });
      categorias.push(cat);
    }

    await Page.findOrCreate({
      where: { slug: 'sobre' },
      defaults: {
        titulo: 'Sobre',
        conteudo: '<p>Bem-vindo ao nosso site gospel! Aqui você encontra palavra, louvor e edificação.</p>',
        status: 'publicado'
      }
    });

    await Post.findOrCreate({
      where: { slug: 'bem-vindo-ao-site-gospel' },
      defaults: {
        titulo: 'Bem-vindo ao Site Gospel',
        resumo: 'Nosso primeiro post de boas-vindas.',
        conteudo: '<p>Este é o primeiro post do nosso site. Que Deus abençoe sua visita!</p>',
        status: 'publicado',
        destaque: true,
        categoriaId: categorias[3].id,
        autorId: admin.id
      }
    });

    console.log('Seed concluído com sucesso!');
    console.log('Login: admin@sitegospel.com | Senha: admin123');
    process.exit(0);
  } catch (e) {
    console.error('Erro no seed:', e.message);
    process.exit(1);
  }
})();
