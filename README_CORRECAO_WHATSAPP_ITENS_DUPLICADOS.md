# Correção WhatsApp PIX balcão — itens duplicados

A rota `POST /api/garcons/app/balcao/:pedidoId/pix/enviar-whatsapp` foi ajustada para usar os itens enviados pelo app no body como fonte principal do resumo do WhatsApp.

Isso corrige o caso em que o pedido no banco ficou com o item duplicado por fluxo antigo, mas o carrinho atual do app tem somente 1 item.

Também foi adicionada proteção para remover duplicidade idêntica no resumo antes de montar a mensagem.
