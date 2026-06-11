# Correção vendas reais SaaS

Ajuste aplicado nas rotas SaaS para que `Vendas hoje`, `Vendas no período` e relatórios financeiros contem somente pedidos com pagamento confirmado.

Antes, alguns cards podiam usar `criadoEm` como fallback e somar pedidos em produção ou registros antigos/migrados que tinham data operacional incorreta.

Agora a regra é:

- conta pedido com `pagoEm` dentro do período; ou
- se `pagoEm` estiver vazio, conta somente quando `statusPagamento` estiver confirmado (`pago`, `aprovado`, etc.) e `criadoEm` estiver dentro do período;
- ignora cancelados, expirados e estornados;
- pedidos apenas `em_producao` sem pagamento confirmado não entram em vendas.
