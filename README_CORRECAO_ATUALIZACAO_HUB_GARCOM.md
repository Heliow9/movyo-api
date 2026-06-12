# Correção - atualização do Hub Garçom em tempo real

Diagnóstico:
- O problema não era somente UI. A API precisava emitir eventos mais específicos sempre que pedido/mesa/balcão fossem alterados.
- O resumo do garçom e a listagem de pedidos agora retornam com headers no-cache.
- O Hub agora força `fresh=1` nas chamadas críticas e escuta eventos extras para recarregar cards, fila/status e ranking.

Arquivos principais alterados na API:
- controllers/mesaController.js
- controllers/balcaoController.js
- controllers/pedidoController.js

Eventos adicionais emitidos:
- atendimentoAtualizado
- resumoGarcomAtualizado
- filaPedidosAtualizada
- rankingGarconsAtualizado
