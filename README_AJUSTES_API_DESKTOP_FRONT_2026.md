# Ajustes API Movyo

Ajustes aplicados:
- PedidoController usa leitura robusta do token Mercado Pago:
  `mercadoPago.accessToken`, `mercadoPago.token`, `mercadoPago.access_token`,
  `mercadoPagoAccessToken` ou `mpAccessToken`.
- Evita falso erro "Restaurante sem Mercado Pago" no PIX parcial do desktop.
- Categoria: reordenação agora funciona com mysqlModelFactory/Mongo, sem depender de `bulkWrite`.
- Produto: normaliza `destaque`, `emDestaque` e `isDestaque`.
