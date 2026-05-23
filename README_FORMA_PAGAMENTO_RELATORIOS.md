# Ajuste de forma de pagamento para relatórios

Esta versão passa a gravar a forma de pagamento do pedido de maneira consistente no banco.

## Campos principais na tabela `pedidos`

- `formaPagamento`: método consolidado do pedido: `pix`, `dinheiro`, `cartao`, `misto` ou `pendente`.
- `statusPagamento`: `pendente`, `pago`, `cancelado`, `error`, etc.
- `valorPago`: valor confirmado como pago.
- `valorPendente`: valor ainda em aberto.
- `pagamentos`: JSON com os lançamentos financeiros do pedido.

## Como fica salvo

### PIX
Ao gerar o PIX, grava `formaPagamento = pix` e um lançamento em `pagamentos` com `status = pendente`.
Quando o Mercado Pago aprova, o webhook muda para `status = confirmado`, atualiza `valorPago`, `valorPendente`, `statusPagamento = pago` e `pagoEm`.

### Cartão
Ao criar cobrança no Mercado Pago, grava `formaPagamento = cartao`.
Se aprovado, grava o lançamento como `confirmado`; se ainda estiver aguardando, fica `pendente` até o webhook atualizar.

### Dinheiro
Pedidos offline/vitrine/salão e pagamentos de balcão em dinheiro gravam `formaPagamento = dinheiro` e lançamento em `pagamentos`.

### Misto
Quando houver mais de uma forma confirmada no mesmo pedido, a coluna `formaPagamento` vira `misto`, e o detalhamento fica em `pagamentos`.

## Exemplo de relatório simples por restaurante

```sql
SELECT
  restaurante,
  formaPagamento,
  COUNT(*) AS quantidade_pedidos,
  SUM(total) AS total_vendido,
  SUM(valorPago) AS total_pago
FROM pedidos
WHERE statusPagamento = 'pago'
GROUP BY restaurante, formaPagamento
ORDER BY restaurante, formaPagamento;
```

## Observação

O model já cria/adiciona automaticamente as colunas que faltarem no MySQL no primeiro uso da API.
