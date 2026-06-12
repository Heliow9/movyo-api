# Correção Hub Garçom - atualização em tempo real

Ajustes aplicados:

1. Home do Hub Garçom
- O resumo agora busca a API com parâmetro `fresh` e limpa o cache local antes da leitura.
- Foram adicionados eventos de socket para recarregar a Home quando pedido/comanda/mesa/balcão forem alterados.
- O ranking dos garçons passa a receber `rankingGarconsHoje` da API.

2. Pedidos > Fila e Status
- A tela remove o cache local antes da consulta.
- A consulta envia `fresh` para evitar retorno antigo.
- A tela agora escuta também `mesaPedidoAtualizado`, `comandaAtualizada`, `balcaoAtualizado` e `pagamentoAtualizado`.

3. API /api/garcons/app/resumo
- Cache de resumo da Home desativado por padrão (`MOVYO_HUB_RESUMO_CACHE_MS=0`).
- O endpoint respeita `fresh`, `noCache` ou `_t` para forçar recálculo.
- O ranking e pedidos do turno agora consideram pedidos lançados no turno, não apenas pedidos pagos.
- Novo campo retornado: `vendasLancadasHojeGarcom`.

Observação:
- Não foi possível executar o build local porque o pacote enviado não veio com o binário `expo` instalado em `node_modules` neste ambiente. Foi feita validação de sintaxe do controller backend com `node --check`.
