# Correção Ranking Garçom

Correção aplicada:

- pedidos pagos agora são atribuídos ao `garcomId` real;
- pagamentos confirmados procuram `pagamentos[].recebidoPor` quando o pedido não tem `garcomId` direto;
- pedidos antigos do balcão/mesa sem responsável deixam de criar o grupo falso `Garçom` quando a Home é aberta pelo próprio garçom;
- novos pedidos passam a salvar `garcomId`, `garcomNome`, `recebidoPor` e `recebidoPorNome` no banco para relatórios futuros.

Depois de subir:

```bash
npm install
pm run start
# ou
pm2 restart movyo-api
```

O sincronizador MySQL da API adiciona as novas colunas automaticamente ao primeiro uso do model `Pedido`.
