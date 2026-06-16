# Web Push do Movyo Hub no iPhone

Esta versão da API implementa notificações remotas para o PWA instalado pela opção **Adicionar à Tela de Início**.

## Eventos enviados

- Pedido criado ou atualizado para `em_producao`.
- Abertura de caixa.

O disparo está centralizado nos modelos `Pedido` e `CaixaSessao`, portanto cobre vitrine, balcão, mesa, Mercado Pago e demais fluxos que persistam o pedido pela camada de modelos da API.

## 1. Instalar dependências

```bash
cd /home/ubuntu/movyo-api
npm install --omit=dev
```

## 2. Gerar as chaves VAPID uma única vez

```bash
npm run push:generate-keys
```

Copie as três linhas retornadas para o `.env` da API:

```env
WEB_PUSH_SUBJECT=mailto:suporte@movyo.delivery
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
```

Não publique a chave privada no Hub, no GitHub ou em variáveis `EXPO_PUBLIC_*`.

**Não gere novas chaves em cada atualização.** Os dispositivos inscritos usam o mesmo par de chaves. Caso ele seja trocado, os usuários precisarão abrir o Hub e sincronizar uma nova inscrição.

## 3. Reiniciar a API

```bash
pm2 restart movyo-api --update-env
pm2 logs movyo-api --lines 100
```

Na inicialização deve aparecer:

```text
🔔 Web Push VAPID configurado.
```

A tabela `push_subscriptions` será criada automaticamente pelo sincronizador MySQL. A migration manual também está em `sql/migrations/012_web_push_subscriptions.sql`.

## 4. Validar a chave pública

```bash
curl https://api.movyo.delivery/api/push/public-key
```

Resposta esperada:

```json
{"ok":true,"publicKey":"..."}
```

## 5. Inscrever o iPhone

1. Abra `https://hub.movyo.delivery` no Safari.
2. Use **Compartilhar → Adicionar à Tela de Início**.
3. Abra o Movyo Hub pelo ícone instalado.
4. Faça login.
5. Toque em **Ativar agora** no banner de notificações.
6. Aceite a permissão do iOS.

A API salvará a inscrição em `POST /api/push/subscribe` associada ao restaurante autenticado.

## 6. Testar sem criar pedido

Com o token do Hub:

```bash
curl -X POST https://api.movyo.delivery/api/push/test \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Teste do Movyo Hub fechado"}'
```

Para verificar inscrições:

```bash
curl https://api.movyo.delivery/api/push/status \
  -H "Authorization: Bearer SEU_TOKEN"
```

## 7. Teste final

1. Feche completamente o Movyo Hub no iPhone.
2. Em outro dispositivo, crie ou altere um pedido para `em_producao`.
3. O aviso **Pedido entrou em produção** deve aparecer na tela bloqueada/Central de Notificações.
4. Abra um novo caixa e confirme também o aviso remoto de caixa aberto.

## Tratamento automático de falhas

- HTTP `404` ou `410`: inscrição desativada imediatamente.
- Outras falhas: contador incrementado; após 5 falhas consecutivas, a inscrição é desativada.
- Reabertura do Hub: o front sincroniza a inscrição novamente e a reativa.
- Eventos repetidos em poucos segundos: deduplicados para evitar notificações duplicadas.
