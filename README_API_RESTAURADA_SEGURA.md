# API restaurada segura

Esta versão usa como base a API completa anterior aos cortes acidentais, preservando os controllers maiores:

- controllers/balcaoController.js
- controllers/pedidoController.js

Mantém os ajustes já feitos antes:

- PIX balcão/mesa com Mercado Pago
- WhatsApp com resumo sem duplicidade
- forma de pagamento para relatórios
- destaques de produto
- categorias mover cima/baixo
- motoristas
- bot/status/QR com persistência de intenção `statusBot.ligado`

Importante: substitui a última API `api-movyo-fix-bot-switch-persistencia.zip`, porque ela voltou alguns controllers para uma versão menor.
