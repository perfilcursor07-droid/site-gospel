
-- Servidor Produção (NÃO use root — use o usuário do site)
su - obuxixogospel
cd /home/obuxixogospel/htdocs/www.obuxixogospel.com.br

-- Deploy SEGURO (não interrompe fila de IA agendada no banco)
git pull github feature/portal-globo
npm install
NODE_ENV=production npm run db:migrate
pm2 reload all

-- A fila fica no MySQL (tabela ia_fila_jobs). O pull + reload NÃO apaga jobs pendentes.
-- Ao reiniciar, jobs "em processamento" voltam para pendente automaticamente.
-- Evite pm2 stop / kill — use pm2 reload para zero-downtime.

pm2 logs --lines 50

Servidor Local Baixar
git pull github feature/portal-globo
npm install
npm run db:migrate
npm run seed
npm run dev

SUBIR GIT
git add .
git commit -m "feat: sua mensagem aqui"
git push origin feature/portal-globo
