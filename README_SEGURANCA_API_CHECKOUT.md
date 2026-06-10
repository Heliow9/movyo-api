# Ajustes de segurança aplicados na API Movyo

Pacote ajustado para reforçar a segurança da vitrine/checkout sem alterar os fluxos internos do balcão/desktop.

## Arquivos alterados

- `index.js`
  - CORS restrito por origem configurável.
  - Limite de JSON para reduzir abuso.
  - Headers básicos de segurança HTTP.
  - Rate limit nas rotas públicas.

- `middlewares/rateLimitPublico.js`
  - Novo middleware leve, sem dependências externas, para limitar abuso em rotas públicas.

- `routes/restauranteRoutes.js`
  - Rate limit aplicado no endpoint público de criação de pedido da vitrine.

- `controllers/pedidoController.js`
  - Checkout público não confia mais no `valorTotal` enviado pela vitrine.
  - Backend recalcula itens com base no cadastro real dos produtos.
  - Bloqueia produto inexistente, inativo, indisponível ou de outro restaurante.
  - Recalcula taxa de entrega por área/bairro ou por raio quando houver configuração.
  - Bloqueia pedido fora da área/raio de entrega com HTTP 422.
  - Sanitiza campos de texto básicos do pedido.
  - Mantém fluxo do balcão/desktop preservado.

## Variáveis úteis

```env
CORS_ORIGINS=https://app.movyo.delivery,https://movyo.delivery,http://localhost:5173,http://localhost:3000
PUBLIC_RATE_LIMIT_WINDOW_MS=60000
PUBLIC_RATE_LIMIT_MAX=40
JSON_BODY_LIMIT=1mb
```

## Observação importante

O bloqueio de entrega depende de dados de frete e localização corretos no restaurante. Se não existir configuração de frete ativa, a API mantém compatibilidade e não bloqueia pedidos antigos automaticamente.
