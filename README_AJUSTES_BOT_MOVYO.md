# Ajustes aplicados no Bot Movyo

## Validação do link da vitrine
O bot agora monta o link do cardápio assim:

- Com slug: `https://app.movyo.delivery/p/slug-do-restaurante`
- Sem slug: `https://app.movyo.delivery/p/`

Também foi adicionado suporte a variável de ambiente opcional:

```env
CARDAPIO_BASE_URL=https://app.movyo.delivery
```

Se essa variável não existir, o sistema usa automaticamente `https://app.movyo.delivery`.

## Melhorias sem quebrar fluxo atual

1. O bot passou a responder diretamente quando o cliente pede:
   - cardápio
   - menu
   - link do cardápio
   - fazer pedido
   - pedido online

2. O bot passou a responder perguntas de horário/funcionamento:
   - está aberto?
   - horário de funcionamento
   - aberto agora?
   - fecha que horas?
   - abre que horas?

3. O bot agora evita responder em grupos por padrão, para não gerar spam acidental.
   Caso queira permitir grupos, configure:

```env
BOT_RESPONDER_GRUPOS=true
```

4. Mantive os fluxos já existentes:
   - saudação automática
   - resposta sobre produto/sabor
   - destaques
   - promoções
   - mensagem de fechado com cooldown
   - reconexão automática do WhatsApp
   - deduplicação de mensagem
   - envio de PIX

## Arquivo alterado

- `utils/bot.js`
