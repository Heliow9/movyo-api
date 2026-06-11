# Ajustes Performance Hub Restaurante

Incluído nesta versão:

- Retry automático em consultas MySQL quando ocorrer `ECONNRESET`, `ETIMEDOUT` ou conexão perdida.
- Pool MySQL com keep-alive e limite maior de conexões.
- `/api/caixa/:restauranteId/atual` sem recálculo pesado a cada refresh; totais calculados por `GROUP BY`.
- `/api/produtos/:restauranteId` em consulta única com JOIN de categorias, evitando duas buscas pesadas em paralelo.
- `/api/categorias/:restauranteId` via SQL direto com retry.
- `/api/restaurantes/me` via SQL direto com cache curto de 5s.
- `/api/garcons` via SQL direto com cache curto de 5s.
- `/api/pedidos/:restauranteId` com retry em caso de conexão resetada.

## Migration opcional/recomendada

```bash
mysql -h movyo.mysql.uhserver.com -u movyo_admin -p movyo < sql/migrations/011_hub_restaurante_performance_indexes.sql
```

Se algum índice já existir e der `Duplicate key name`, remova apenas aquele índice específico ou ignore se ele já cobre a consulta.

## Reinício

```bash
pm2 restart all
```
