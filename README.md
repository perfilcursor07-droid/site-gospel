# Site Gospel

Portal de notícias gospel com CMS próprio (estilo WordPress) desenvolvido em **Node.js + Express + MySQL**, com layout editorial inspirado nos grandes portais de notícias brasileiros.

## Funcionalidades

### Site público (visual de portal de notícias)

- **Header fixo (sticky)** com logo configurável, busca integrada, menu de categorias com cores próprias e menu hambúrguer no mobile
- **Home com hierarquia editorial:** manchete principal com imagem full-bleed e gradiente, coluna de manchetes secundárias, blocos por categoria com barra colorida, grid de cards e feed de últimas publicações com thumbnail
- **Página de post:** breadcrumb, categoria colorida, tipografia de leitura confortável, bloco “Leia também” com posts relacionados e compartilhamento (WhatsApp, Facebook, X)
- **Página de categoria** com descrição e paginação
- **Busca** com highlight do termo e estado vazio amigável
- **Footer completo:** 3 colunas (sobre, categorias, links úteis), redes sociais e copyright customizável
- **SEO completo:** meta tags, Open Graph, Twitter Card, JSON-LD (WebSite + NewsArticle), canonical, `sitemap.xml` e `robots.txt` dinâmicos, toggle de indexação (noindex) e SEO por post (meta title/description)
- Cada categoria possui **cor de destaque** e **ordem no menu** configuráveis

### Painel administrativo

- **Dashboard** com cards de estatísticas (posts, publicados, rascunhos, páginas, categorias, usuários), gráfico de posts por mês (CSS puro), últimos 10 posts com ações rápidas e atalhos
- **Configurações em abas:** Identidade (nome, slogan, descrição, logo, favicon, cor primária), SEO (contadores de caracteres, imagem OG com preview, prévia do snippet do Google, toggle de indexação), Redes sociais, Integrações Google (Search Console, Analytics, código custom no head) e Rodapé (copyright + links)
- **Posts:** slug auto-gerado e editável, preview da imagem destacada, SEO por post, destaque na home e botão “Ver no site”
- **Categorias:** cor de destaque (color picker) e ordem de exibição
- **Login** elegante com logo do site
- Topbar com avatar e badge de papel; sidebar colapsável no mobile

### Autenticação com níveis de acesso

- **Administrador:** acesso total, incluindo usuários e configurações
- **Gestor:** gerencia posts, páginas e categorias
- **Usuário:** cria e edita apenas os próprios posts, sempre como rascunho

### Outros

- Upload de imagens validado (apenas imagens, máx. 5MB)
- Mensagens flash de sucesso/erro em todas as ações
- Slugs amigáveis (SEO) gerados automaticamente

## Requisitos

- Node.js 18+
- MySQL 8+

## Instalação

```bash
# 1. Instale as dependências
npm install

# 2. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com os dados do seu MySQL

# 3. Crie o banco de dados no MySQL
# CREATE DATABASE site_gospel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 4. Rode as migrations
npm run db:migrate

# 5. Popule o banco com dados iniciais (admin, categorias gospel e posts de exemplo)
npm run seed

# 6. Inicie o servidor
npm run dev
```

Acesse **http://localhost:3000** (site) e **http://localhost:3000/login** (painel).

### Acesso inicial

| Campo | Valor |
|---|---|
| E-mail | `admin@sitegospel.com` |
| Senha | `admin123` |

> Altere a senha do administrador após o primeiro acesso.

### Dados de exemplo (seed)

O seed cria as categorias gospel **Notícias, Louvor, Estudos Bíblicos, Testemunhos e Devocionais** (cada uma com cor e ordem próprias), posts realistas publicados, a página “Sobre” e as configurações padrão do portal.

## Telas (descrição)

- **Home:** manchete grande à esquerda com título branco sobre gradiente escuro, coluna direita com manchetes secundárias, seções por categoria com barra colorida e feed “Últimas publicações”
- **Post:** leitura em coluna única (max-w-3xl), breadcrumb, botões de compartilhamento e “Leia também”
- **Dashboard:** seis cards de métricas, gráfico de barras laranja e tabela de últimos posts
- **Configurações:** cinco abas com previews ao vivo (logo, favicon, OG e snippet do Google)

## Estrutura do projeto

```
src/
  config/       # Conexão MySQL (Sequelize) e upload (multer)
  database/     # Migrations Sequelize
  models/       # User, Category, Post, Page, Setting
  middlewares/  # Autenticação e controle de acesso por papel
  routes/       # Rotas públicas, auth e painel admin
  views/        # Templates EJS (site, login e admin)
  server.js     # Aplicação Express
  seed.js       # Dados iniciais
public/css/     # Estilos do painel admin
uploads/        # Imagens enviadas pelo painel
```
