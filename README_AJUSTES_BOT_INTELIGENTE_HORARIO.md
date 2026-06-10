# Ajustes aplicados no bot Movyo

## 1. Correção do status aberto/fechado
- O cálculo de horário agora usa fuso horário configurável.
- Padrão: `America/Recife`.
- Pode ser alterado no `.env` com:

```env
BOT_TIMEZONE=America/Recife
```

Isso evita o erro do servidor em UTC fazer o bot responder como fechado quando o restaurante ainda está aberto no horário local.

## 2. Bot consultando categoria/produtos
O bot agora tenta responder perguntas como:

- `tem hambúrguer?`
- `quais hambúrgueres tem?`
- `tem guaraná?`
- `tem coca?`
- `tem pizza de calabresa?`
- `tem promoção?`
- `quais destaques?`

A busca respeita:

- restaurante atual;
- produto ativo;
- produto ativo na vitrine;
- produto disponível;
- categoria ativa.

## 3. Reação antes da resposta
Antes de responder, o bot reage à mensagem do cliente com emoji relacionado ao assunto:

- hambúrguer: 🍔
- pizza: 🍕
- bebida: 🥤
- promoção: 🔥
- horário: 🕒
- geral/cardápio: ❤️

## Arquivos alterados

- `utils/atendimento.js`
- `utils/bot.js`

## Observação
Não foram alterados controllers de pedido, caixa, produtos, pagamento, webhook, iFood, mesas ou autenticação.
