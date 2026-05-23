# Correção PIX ao fechar mesa pelo app Garçom

Ajustes aplicados:

1. A API agora considera Mercado Pago conectado quando existe `mercadoPago.accessToken`, mesmo se o campo legado `mercadoPago.conectado` vier falso/ausente.
2. A rota `GET /api/mercadopago/status/:restauranteId` agora retorna também `hasAccessToken`.
3. As rotas de PIX de mesa usam a mesma leitura robusta de credencial Mercado Pago.

Isso corrige o caso em que o balcão gera PIX normalmente, mas a comanda/mesa informa incorretamente que o Mercado Pago não está conectado.
