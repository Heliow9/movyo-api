# Hotfix Movyo API - Totais do Hub/Pedidos

Correção para pedidos exibidos no Movyo Hub em Home => Pedidos com valor R$ 0,00 após otimizações de listagem.

## Ajustes

- `controllers/pedidoController.js`
  - A listagem otimizada agora recalcula `total` e `valorTotal` quando a coluna `total` vier zerada, usando:
    - `totalBruto - desconto`
    - soma de `itens[].precoTotal` / `itens[].total` / `itens[].valorTotal`
    - `precoUnitario * quantidade`
    - snapshot do pedido cancelado, quando houver
  - Também hidrata valores dos itens para o Hub não receber itens zerados.

- `lib/mysqlModelFactory.js`
  - Proteção para campos aliases que gravam na mesma coluna física, como `total` e `valorTotal`.
  - Evita que um alias default `0` sobrescreva outro alias com valor real.

## Aplicação

Suba por cima da API preservando `.env` e `uploads`.
Depois rode:

```bash
cd /home/ubuntu/movyo-api
npm install
pm2 restart movyo-api
pm2 logs movyo-api --lines 100
```

Teste:

```bash
curl -H "Authorization: Bearer SEU_TOKEN" "https://api.movyo.delivery/api/garcons/app/pedidos?limit=10&fresh=1"
```

Verifique se os pedidos retornam `total` e `valorTotal` maior que zero quando os itens possuem preço.
