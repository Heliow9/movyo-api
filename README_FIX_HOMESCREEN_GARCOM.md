# Correção HomeScreen / Pedidos Garçom

Ajustes aplicados:

1. `/api/garcons/app/resumo`
   - Não conta mais `aguardando_pagamento` como pedido pendente.
   - Não conta pedido Pix/cartão pendente na Home.
   - Conta mesa aberta apenas se a mesa estiver ocupada e tiver `pedidoAtualId` ativo.
   - Evita contar mesa legada travada com status `ocupada` mas sem pedido operacional.

2. `/api/garcons/app/pedidos`
   - Corrigido filtro que usava `$nin/$exists`, pois o adapter MySQL do projeto não suporta esses operadores de forma confiável.
   - A listagem padrão agora remove `aguardando_pagamento` em JavaScript, sem zerar a lista inteira.
   - Se precisar ver aguardando pagamento manualmente, use `?status=aguardando_pagamento`.

3. Compatibilidade
   - Nenhum campo antigo foi removido.
   - A API continua retornando `mesasOcupadas`, `pedidosFila`, `mesasAbertas` e `pedidosPendentes`.
