# Correção — proteção contra itens duplicados no balcão

A rota `POST /balcao/:pedidoId/itens` agora evita duplicar itens quando recebe o mesmo carrinho que já está salvo no pedido.

Isso protege a API mesmo se alguma versão antiga do app ainda chamar `/itens` logo após criar o pedido.
