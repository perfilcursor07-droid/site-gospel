
-- Servidor Produção
cd /home/obuxixogospel/htdocs/www.obuxixogospel.com.br
git pull origin feature/portal-globo
npm install
npm run db:migrate

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