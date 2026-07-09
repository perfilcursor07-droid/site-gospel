
-- Servidor Produção (NÃO use root — use o usuário do site)
su - obuxixogospel
cd /home/obuxixogospel/htdocs/www.obuxixogospel.com.br
git pull github feature/portal-globo
NODE_ENV=production npm run db:migrate
pm2 restart all

npm install
NODE_ENV=production npm run db:migrate
pm2 restart all
pm2 logs --lines 50

Servidor Local Baixar
git pull github feature/portal-globo
npm install
npm run db:migrate
npm run seed
npm run dev

SUBIR GIT
git status
git add .
git commit -m "feat: sua mensagem aqui"
git push github feature/portal-globo
