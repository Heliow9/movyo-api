# Ajustes pedidos, caixa e bot — 2026-06-15

- Pedidos da vitrine pagos passam a ficar em `pago`/Recebidos até aceitação manual.
- Pedidos são vinculados ao caixa aberto no momento da criação.
- Vendas offline da vitrine são registradas no caixa do turno.
- Aceitação grava `emProducaoEm`; entrega grava `emEntregaEm`.
- Webhook do Mercado Pago mantém vitrine em Recebidos e balcão em produção.
