Correção Mercado Pago OAuth - Movyo API

Causa real:
- O callback chegava e redirecionava com ?mp=ok, ou seja, a troca do code pelo token estava passando.
- Porém o campo mercadoPago no banco MySQL é JSON/LONGTEXT.
- O mysqlModelFactory atual não salva updates com chaves pontuadas como "mercadoPago.conectado".
- Resultado: a API retornava mp=ok, mas o restaurante continuava sem mercadoPago.accessToken/conectado salvo.

Como aplicar:
1) Substitua na API:
   controllers/mercadoPagoController.js

2) No servidor, confira o .env da API:
   APP_URL=http://localhost:5173/#/configuracoes
   MP_REDIRECT_URI=https://api.movyo.delivery/api/mercadopago/oauth/callback

   Para desktop em desenvolvimento, localhost funciona.
   Em produção/web, APP_URL deve ser a URL real do front.

3) Reinicie a API:
   pm2 restart movyo-api
   ou o nome correto do processo.

4) Conecte novamente o Mercado Pago pelo desktop e clique em Atualizar status.
