# Site Gospel

Site gospel com CMS próprio (estilo WordPress) desenvolvido em **Node.js + Express + MySQL**.

## Funcionalidades

- **Site público:** página inicial com destaques, posts por categoria, páginas estáticas e busca
- **Painel administrativo:** dashboard com estatísticas e CRUD completo de posts, páginas, categorias e usuários
- **Autenticação com níveis de acesso:**
  - **Administrador:** acesso total, incluindo gerenciamento de usuários
  - **Gestor:** gerencia posts, páginas e categorias
  - **Usuário:** cria e edita apenas os próprios posts, sempre como rascunho
- Upload de imagem destacada nos posts
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

# 4. Popule o banco com dados iniciais (cria o usuário admin)
npm run seed

# 5. Inicie o servidor
npm run dev
```

Acesse **http://localhost:3000** (site) e **http://localhost:3000/login** (painel).

### Acesso inicial

| Campo | Valor |
|---|---|
| E-mail | `admin@sitegospel.com` |
| Senha | `admin123` |

> Altere a senha do administrador após o primeiro acesso.

## Estrutura do projeto

```
src/
  config/       # Conexão MySQL (Sequelize) e upload (multer)
  models/       # User, Category, Post, Page
  middlewares/  # Autenticação e controle de acesso por papel
  routes/       # Rotas públicas, auth e painel admin
  views/        # Templates EJS (site, login e admin)
  server.js     # Aplicação Express
  seed.js       # Dados iniciais
public/css/     # Estilos do site e do painel
uploads/        # Imagens enviadas pelo painel
```
