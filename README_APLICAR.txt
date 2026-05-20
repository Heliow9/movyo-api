PATCH REAL - Mercado Pago OAuth MySQL JSON

Problema:
O campo restaurantes.mercadoPago é JSON/LONGTEXT.
O mysqlModelFactory NÃO persiste chaves pontuadas como:
  "mercadoPago.accessToken"
  "mercadoPago.conectado"

Correção:
O controller agora lê o mercadoPago atual, mescla os tokens, e salva o objeto inteiro:
  $set: { mercadoPago: mercadoPagoNovo }

Aplicar:
1) Substituir controllers/mercadoPagoController.js na API.
2) Reiniciar:
   pm2 restart movyo-api
3) Testar de novo o botão Conectar.

Validação esperada no log da API após autorizar:
  ✅ TOKEN OK ... has_access_token: true
  💾 MERCADO PAGO SALVO ... conectado: true, hasAccessToken: true
