# Ajustes PIX balcão / WhatsApp / Electron

Arquivos alterados:

- `controllers/balcaoController.js`
- `controllers/mercadoPagoWebhookController.js`
- `controllers/mesaController.js`
- `controllers/pedidoController.js`

## O que foi corrigido

1. Ao abrir pedido de balcão ou gerar PIX pendente, a API não emite mais `novoPedido` para o Electron.
   - Isso evita a notificação “Novo pedido recebido” antes do cliente pagar.

2. Pedido de balcão nasce como `aguardando_pagamento`.
   - Só vai para `em_producao` quando o pagamento for confirmado.

3. O resumo enviado no WhatsApp agora monta os itens diretamente do `pedido.itens` na API.
   - Inclui quantidade, nome, valor, sabores, borda, adicionais, complementos, extras e observação quando existirem.

4. A confirmação do pagamento é enviada para o mesmo número usado no envio do PIX.
   - O número é salvo dentro do pagamento PIX pendente em `pagamentos[].whatsappPixNumero`.
   - Funciona tanto pela consulta de status quanto pelo webhook do Mercado Pago.

5. O resumo da Home do app garçom não conta mais pedidos `aguardando_pagamento` como fila pendente.
   - Conta apenas pedidos em produção.

## Depois de subir no servidor

```bash
cd /home/ubuntu/movyo-api
npm install
pm run start
# ou, se usa PM2:
pm2 restart movyo-api --update-env
pm2 logs movyo-api
```

Se o nome do processo PM2 for outro, rode:

```bash
pm2 list
pm2 restart NOME_DO_PROCESSO --update-env
```
