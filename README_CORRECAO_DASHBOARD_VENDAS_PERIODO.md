# Correção Dashboard SaaS - Vendas no período

## Problema corrigido
A rota `/api/saas/overview` podia apresentar valor diferente da tela Operação porque usava `created_at` como fallback em:

`COALESCE(pagoEm, criadoEm, created_at)`

Em registros antigos ou migrados, `created_at` pode representar a data de criação/importação do registro no banco, não a data real da venda. Isso inflava o total do período.

## Ajuste aplicado
Agora as vendas do período usam apenas datas operacionais do pedido:

`COALESCE(pagoEm, criadoEm)`

Também foi ajustada a conversão de datas para usar horário local do servidor, evitando deslocamento UTC com `toISOString()`.

## Resultado esperado
Com restaurante e data iguais, os cards da Home e da Operação passam a bater nos totais de vendas/pedidos do período.
