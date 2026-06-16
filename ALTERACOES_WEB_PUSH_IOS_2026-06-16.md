# Alterações — Web Push do Movyo Hub

## Implementado

- `GET /api/push/public-key` para entregar somente a chave pública VAPID.
- `POST /api/push/subscribe` autenticado para registrar/atualizar a inscrição do dispositivo por restaurante.
- `DELETE /api/push/subscribe` para desativar uma inscrição.
- `GET /api/push/status` para diagnóstico do restaurante.
- `POST /api/push/test` para teste autenticado com acesso de restaurante.
- Persistência MySQL em `push_subscriptions`.
- Disparo remoto quando qualquer pedido entra pela primeira vez em `em_producao`.
- Disparo remoto na abertura de caixa.
- Cobertura central para criação, `save`, `findByIdAndUpdate`, `findOneAndUpdate`, `updateOne` e `updateMany` da camada de modelos.
- Remoção lógica automática para endpoints expirados (`404`/`410`).
- Desativação após falhas consecutivas configuráveis.
- Deduplicação de eventos em janela curta.
- Tags compatíveis com a notificação local do Hub para evitar alerta duplicado quando o app estiver aberto.
- Script `npm run push:generate-keys`.
- Guia de implantação em `GUIA_WEB_PUSH_IOS_MOVYO.md`.

## Arquivos principais

- `services/webPushService.js`
- `routes/pushRoutes.js`
- `models/PushSubscription.js`
- `models/Pedido.js`
- `models/CaixaSessao.js`
- `lib/mysqlModelFactory.js`
- `sql/migrations/012_web_push_subscriptions.sql`
- `scripts/generate-vapid-keys.js`

## Configuração obrigatória no servidor

```env
WEB_PUSH_SUBJECT=mailto:suporte@movyo.delivery
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
```
