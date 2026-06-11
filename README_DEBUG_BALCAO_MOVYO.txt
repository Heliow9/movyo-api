DEBUG BALCÃO - Movyo

Este pacote adiciona logs detalhados para identificar onde o fluxo do Pedido Balcão está travando.

Arquivos alterados na API:
- controllers/balcaoController.js

Logs adicionados no PM2:
[BALCAO-...] REQUEST RECEBIDA /abrirPedidoBalcao
[BALCAO-...] INICIO/FIM exigirCaixaAberto
[BALCAO-...] INICIO/FIM gerarProximoNumeroBalcao
[BALCAO-...] INICIO/FIM novoPedido.save
[BALCAO-...] REQUEST RECEBIDA /registrarPagamentoBalcao
[BALCAO-...] INICIO/FIM buscarPedido
[BALCAO-...] INICIO/FIM registrarPagamentosConfirmadosNoCaixa
[BALCAO-...] INICIO/FIM recalcularCaixa
[BALCAO-...] INICIO/FIM fecharPedidoGenerico

Como testar:
1. Suba a API.
2. Reinicie: pm2 restart all
3. Abra logs: pm2 logs --lines 300
4. No Movyo Hub Garçom, tente Pedido Balcão novamente.
5. Envie os logs que começam com [BALCAO-...].
