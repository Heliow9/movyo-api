# Rollout de performance da API Movyo

As alteracoes de performance mantem os contratos HTTP e os nomes dos eventos Socket.IO.
O adaptador MySQL usa SQL nativo quando o filtro e compativel e preserva o filtro em
memoria como fallback para regex, caminhos JSON pontuados e operadores ainda nao
traduzidos.

## Validacao antes do deploy

```bash
npm install
npm run test:unit
node scripts/sync-mysql.js
node scripts/ensure-performance-indexes.js
```

Depois, reinicie apenas uma instancia da API e valide:

- `GET /health` para liveness do processo;
- `GET /ready` para disponibilidade do banco e inicializacao;
- login de restaurante e garcom;
- abertura/fechamento de mesa;
- criacao e alteracao de pedido;
- entrada do entregador, GPS, oferta, aceite e recusa;
- cardapio e checkout publicos.

## Configuracao inicial compativel

```env
SYNC_SCHEMA_ON_STARTUP=true
SOCKET_REQUIRE_AUTH=false
LOCATION_PERSIST_INTERVAL_MS=3000
LOCATION_MAX_EVENTS_PER_SECOND=5
MYSQL_QUEUE_LIMIT=200
MYSQL_SLOW_QUERY_MS=750
```

`SOCKET_REQUIRE_AUTH=false` mantem clientes antigos conectando. Mesmo nesse modo,
um cliente que envia JWT valido nao pode entrar na sala de outro restaurante.

Depois que Desktop, Hub, Garcom e Entregador enviarem o JWT no handshake do socket,
altere para:

```env
SOCKET_REQUIRE_AUTH=true
```

Quando as migrations fizerem parte obrigatoria do deploy, evite DDL durante o startup:

```env
SYNC_SCHEMA_ON_STARTUP=false
```

## Cluster e Redis

A API deve continuar com `instances: 1` ate que exista um Redis acessivel pela mesma
rede da API. Antes de habilitar duas ou mais instancias, ainda e necessario:

1. configurar o Redis Adapter do Socket.IO;
2. mover presenca de entregadores para Redis com TTL;
3. mover expiracao de ofertas e cancelamentos para uma fila persistente;
4. substituir locks locais de oferta por operacoes atomicas no MySQL ou lock distribuido;
5. executar os bots WhatsApp em um worker separado.

Habilitar cluster antes dessas etapas pode duplicar timers, perder presenca e permitir
corridas no aceite de ofertas.

## Observabilidade e rollback

O monitor da API agora inclui p50, p95 e p99 por rota. Consultas acima de
`MYSQL_SLOW_QUERY_MS` geram log `MYSQL-SLOW` sem imprimir parametros sensiveis.

Para reduzir o agrupamento de GPS durante uma investigacao, use
`LOCATION_PERSIST_INTERVAL_MS=1000`. Para retornar temporariamente ao acesso legado
do socket, use `SOCKET_REQUIRE_AUTH=false`.
