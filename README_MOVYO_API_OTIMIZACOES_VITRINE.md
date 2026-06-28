# Movyo API — otimizações para vitrine pública

## O que foi ajustado

- Criada rota rápida de cardápio público:
  - `GET /api/vitrine/cardapio/:slug`
- Criada rota rápida para dados do checkout:
  - `GET /api/vitrine/checkout-config/:restauranteId`
- As novas rotas usam SQL direto com `WHERE`, `ORDER BY` e menos chamadas encadeadas.
- A rota de cardápio retorna restaurante, categorias e produtos já agrupados.
- Adicionado cache curto em memória para cardápio público.
- Mantidas as rotas antigas para compatibilidade:
  - `/api/restaurantes/:slug`
  - `/api/produtos/:restauranteId`
  - `/api/restaurantes/horario/:id`
- Melhorado `lib/mysqlModelFactory.js` para filtros simples gerarem `WHERE` SQL em vez de sempre fazer `SELECT *` e filtrar no Node.
- `countDocuments()` agora usa `COUNT(*)` quando o filtro é compatível com SQL.
- Adicionados índices de performance no script `scripts/ensure-performance-indexes.js`.
- Adicionados campos `marketplace` e `externalOrderId` no model de Pedido para compatibilizar integrações/índice já previsto.
- `/uploads` ganhou headers de cache para reduzir carga em imagens públicas.

## Depois de subir no servidor

Rodar, dentro da pasta da API:

```bash
npm install
node scripts/sync-mysql.js
node scripts/ensure-performance-indexes.js
pm2 restart movyo-api
```

Se o processo PM2 tiver outro nome, trocar `movyo-api` pelo nome correto.

## Compatibilidade

As melhorias foram feitas mantendo as rotas antigas. A vitrine nova usa as rotas rápidas, mas tem fallback para o fluxo antigo caso a API ainda não esteja atualizada.
