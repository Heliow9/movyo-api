# Otimização /api/saas/overview

A rota `/api/saas/overview` foi otimizada para não carregar tabelas inteiras em memória.
Agora usa `COUNT`, `SUM` e `GROUP BY` direto no MySQL, com consultas em paralelo via `Promise.all`.

Também foi criada a migration:

`sql/migrations/006_saas_overview_performance_indexes.sql`

Execute essa migration no banco para acelerar filtros por restaurante e data.

O retorno agora inclui `performanceMs`, útil para conferir o tempo real de montagem do payload no backend.
