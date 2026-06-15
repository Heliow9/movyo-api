# Ajustes aplicados — 15/06/2026

## WhatsApp
- Presença "digitando" com duração limitada e variação natural.
- Pequena pausa variável antes das reações.
- Intervalo padrão entre mensagens aumentado e configurável.
- Suporte a mensagem de boas-vindas personalizada (`boasVindas`, `saudacao` ou `mensagemInicial`).
- Mantido o mesmo boot, reconexão, watchdog e registro de listeners.

### Variáveis opcionais
- `BOT_SEND_GAP_MS` (padrão 900)
- `BOT_TYPING_MIN_MS` (padrão 900)
- `BOT_TYPING_MAX_MS` (padrão 3200)
- `BOT_REACTION_DELAY_MIN_MS` (padrão 250)
- `BOT_REACTION_DELAY_MAX_MS` (padrão 750)

## Checkout/API
- Frete e taxa de cartão não são mais enviados como produtos.
- API mantém compatibilidade com carrinhos antigos que ainda enviem esses itens sintéticos.
- Produtos, adicionais e total continuam recalculados no servidor.
- Taxa de cartão é recalculada pela API conforme configuração do restaurante.
- Mensagem da vitrine orienta o cliente quando houver item removido ou desatualizado.
