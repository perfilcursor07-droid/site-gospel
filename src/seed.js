require('dotenv').config();
const { sequelize, User, Category, Post, Page, Setting } = require('./models');

const categoriasBase = [
  { nome: 'Notícias', cor: '#dc2626', ordem: 1, descricao: 'Novidades, eventos e acontecimentos do meio gospel.' },
  { nome: 'Músicas', cor: '#f97316', ordem: 2, descricao: 'Lançamentos, artistas, álbuns e tendências da música gospel.' },
  { nome: 'Estudos Bíblicos', cor: '#2563eb', ordem: 3, descricao: 'Ensino bíblico e reflexões para aprofundar a fé.' },
  { nome: 'Devocionais', cor: '#9333ea', ordem: 4, descricao: 'Mensagens diárias para edificação e comunhão com Deus.' }
];

const postsBase = [
  {
    titulo: 'Congresso Nacional de Louvor reúne mais de 20 mil pessoas em São Paulo',
    categoria: 'Notícias',
    destaque: true,
    resumo: 'Evento reuniu ministérios de todo o país em três dias de adoração, workshops e mensagens.',
    conteudo: '<p>O Congresso Nacional de Louvor chegou à sua décima edição reunindo mais de 20 mil pessoas no pavilhão de exposições de São Paulo. Durante três dias, ministérios de louvor de todo o Brasil conduziram momentos de adoração e capacitação.</p><p>Além dos grandes momentos de música, o evento contou com workshops de teologia da adoração, técnica vocal e produção musical, alcançando também os pequenos grupos de igrejas locais.</p><p>A organização anunciou que a próxima edição terá transmissão ao vivo e caravanas de todas as regiões do país.</p>'
  },
  {
    titulo: 'Novo álbum de adoração congregacional é lançado com participações especiais',
    categoria: 'Músicas',
    destaque: true,
    resumo: 'Projeto gravado ao vivo traz dez canções inéditas focadas na igreja local.',
    conteudo: '<p>Foi lançado nesta semana um novo álbum de adoração congregacional gravado ao vivo, com dez canções inéditas. O projeto nasceu com o propósito de servir a igreja local com músicas acessíveis para o culto.</p><p>As letras percorrem temas como graça, comunhão e esperança, e as cifras foram disponibilizadas gratuitamente para ministérios de louvor.</p>'
  },
  {
    titulo: 'O que significa andar em novidade de vida? Um estudo em Romanos 6',
    categoria: 'Estudos Bíblicos',
    destaque: true,
    resumo: 'Entenda o que Paulo quis dizer com morrer para o pecado e viver para Deus.',
    conteudo: '<p>Em Romanos 6, o apóstolo Paulo apresenta uma das verdades mais profundas da vida cristã: fomos sepultados com Cristo e ressuscitamos para andar em novidade de vida.</p><p>Este estudo percorre o capítulo verso a verso, mostrando como a união com Cristo transforma a identidade do cristão e sua relação com o pecado.</p><p>Ao final, propomos perguntas de aplicação para pequenos grupos e devocionais pessoais.</p>'
  },
  {
    titulo: 'De volta à vida: história de superação após anos de dependência química',
    categoria: 'Notícias',
    destaque: false,
    resumo: 'Depois de dez anos nas ruas, ele encontrou restauração completa e hoje lidera um projeto social.',
    conteudo: '<p>Durante dez anos, João viveu nas ruas em dependência química, afastado da família. O encontro com uma comunidade de fé mudou completamente a direção da sua história.</p><p>Hoje, restaurado e reconciliado com a família, ele lidera um projeto social que acolhe pessoas em situação de rua, oferecendo alimentação, acompanhamento e esperança.</p>'
  },
  {
    titulo: 'Devocional: a paz que excede todo entendimento',
    categoria: 'Devocionais',
    destaque: false,
    resumo: 'Uma reflexão em Filipenses 4 para dias de ansiedade.',
    conteudo: '<p>“Não andeis ansiosos por coisa alguma” (Filipenses 4.6). Em dias acelerados, a Palavra nos convida a apresentar tudo a Deus em oração, com ações de graças.</p><p>A promessa é clara: a paz de Deus, que excede todo entendimento, guardará o coração e a mente daqueles que confiam nele.</p>'
  },
  {
    titulo: 'Pesquisa aponta crescimento de igrejas evangélicas no interior do país',
    categoria: 'Notícias',
    destaque: false,
    resumo: 'Levantamento mostra avanço de comunidades em cidades com menos de 50 mil habitantes.',
    conteudo: '<p>Um novo levantamento aponta o crescimento consistente de comunidades evangélicas em cidades pequenas do interior do Brasil na última década.</p><p>Especialistas destacam o papel de projetos sociais e da presença comunitária das igrejas como fatores centrais desse avanço.</p>'
  },
  {
    titulo: 'Salmos de lamento: quando a adoração encontra a dor',
    categoria: 'Estudos Bíblicos',
    destaque: false,
    resumo: 'Por que um terço do saltério é composto por lamentos e o que isso ensina sobre oração.',
    conteudo: '<p>Cerca de um terço dos Salmos são lamentos — orações honestas de dor, dúvida e espera. Longe de demonstrar falta de fé, o lamento bíblico é um ato profundo de confiança.</p><p>Este estudo apresenta a estrutura típica dos salmos de lamento e como usá-los na vida devocional e no aconselhamento.</p>'
  },
  {
    titulo: 'Devocional: recomeços na mão do Oleiro',
    categoria: 'Devocionais',
    destaque: false,
    resumo: 'Jeremias 18 e a esperança de que Deus refaz o que se quebrou.',
    conteudo: '<p>Na casa do oleiro, Jeremias viu um vaso se estragar nas mãos do artesão — e o oleiro fez de novo outro vaso, conforme lhe pareceu melhor.</p><p>Essa cena é um convite à esperança: nas mãos de Deus, histórias quebradas podem ser refeitas com propósito e beleza.</p>'
  }
];

(async () => {
  try {
    await sequelize.authenticate();

    const [admin] = await User.findOrCreate({
      where: { email: 'admin@sitegospel.com' },
      defaults: { nome: 'Administrador', senha: 'admin123', papel: 'administrador' }
    });

    const categorias = {};
    for (const c of categoriasBase) {
      const [cat] = await Category.findOrCreate({
        where: { nome: c.nome },
        defaults: { descricao: c.descricao, corHex: c.cor, ordem: c.ordem }
      });
      cat.descricao = c.descricao;
      cat.corHex = c.cor;
      cat.ordem = c.ordem;
      await cat.save();
      categorias[c.nome] = cat;
    }

    // Migra categorias antigas do seed anterior
    const migracoes = [
      { slug: 'louvor', novoNome: 'Músicas' },
      { slug: 'testemunhos', novoNome: 'Notícias' }
    ];
    for (const m of migracoes) {
      const antiga = await Category.findOne({ where: { slug: m.slug } });
      const destino = categorias[m.novoNome];
      if (antiga && destino && antiga.id !== destino.id) {
        await Post.update({ categoriaId: destino.id }, { where: { categoriaId: antiga.id } });
        await antiga.destroy();
      }
    }

    await Page.findOrCreate({
      where: { slug: 'sobre' },
      defaults: {
        titulo: 'Sobre',
        conteudo: '<p>Somos um portal gospel dedicado a levar informação, edificação e esperança. Aqui você encontra notícias, músicas, estudos bíblicos e devocionais.</p>',
        status: 'publicado'
      }
    });

    let diasAtras = postsBase.length;
    for (const p of postsBase) {
      const publicadoEm = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
      diasAtras -= 1;
      await Post.findOrCreate({
        where: { titulo: p.titulo },
        defaults: {
          resumo: p.resumo,
          conteudo: p.conteudo,
          status: 'publicado',
          destaque: p.destaque,
          publicadoEm,
          categoriaId: categorias[p.categoria].id,
          autorId: admin.id
        }
      });
    }

    // Configurações padrão do portal (não sobrescreve valores já definidos)
    const configPadrao = {
      site_nome: 'Site Gospel',
      site_slogan: 'Notícias, louvor e edificação',
      site_descricao: 'Portal gospel com notícias, músicas, estudos bíblicos e devocionais.',
      cor_primaria: '#ea580c',
      seo_titulo: 'Site Gospel — Notícias, louvor e edificação',
      seo_descricao: 'Acompanhe notícias gospel, lançamentos musicais, estudos bíblicos e devocionais diários.',
      seo_palavras_chave: 'gospel, notícias gospel, música gospel, estudos bíblicos, devocionais',
      seo_indexar: 'sim',
      footer_copyright: '',
      footer_links: 'Sobre|/pagina/sobre\nBusca|/busca'
    };
    const configAtual = await Setting.obterTodas();
    for (const [chave, valor] of Object.entries(configPadrao)) {
      if (!(chave in configAtual)) await Setting.definir(chave, valor);
    }

    console.log('Seed concluído com sucesso!');
    console.log('Login: admin@sitegospel.com | Senha: admin123');
    process.exit(0);
  } catch (e) {
    console.error('Erro no seed:', e.message);
    process.exit(1);
  }
})();
