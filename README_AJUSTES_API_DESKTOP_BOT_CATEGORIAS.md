# Ajustes aplicados na API Movyo

## Categorias
- Corrigida a ordem das rotas de categorias.
- `/api/categorias/ordem/reordenar` agora é lida antes de `/:id` e `/:restauranteId`.
- Isso corrige mover categorias para cima/baixo no Desktop.

## Bot WhatsApp
- Status do Bot agora lê corretamente `statusBot` mesmo quando vem como JSON/string do MySQL.
- Se o Bot estiver marcado como ligado e a API reiniciar, a API tenta restaurar a instância automaticamente.
- A restauração inicial busca restaurantes e filtra em JS, evitando falha com consulta em campo JSON `statusBot.ligado`.

## Motoristas / Entregadores
- Cadastro cria motorista ativo por padrão.
- Bloqueio pelo Desktop salva `statusConta: bloqueado` e também sincroniza `status: false`.
- Login do motorista bloqueado passa a ser recusado.
- Token do motorista usa o campo correto `restaurante`.

## Produtos em destaque
- Campo `destaque` permanece preservado no model e nas rotas de produto.

## Rotas de pedido balcão
- Rotas existentes foram mantidas para não quebrar o fluxo já corrigido de balcão, PIX, WhatsApp e desktop.
