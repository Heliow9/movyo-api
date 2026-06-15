# API Movyo — segurança, auditoria e relatórios

- bloqueio e vencimento continuam obrigatórios no middleware de autenticação;
- rotas administrativas de produtos, categorias, frete, balcão, mesas, pedidos operacionais e caixa foram protegidas;
- validação contra acesso cruzado entre restaurantes;
- auditoria persistente para ações críticas;
- permissões por operador de caixa;
- relatórios de venda usam somente vendas confirmadas;
- data financeira padronizada em `pagoEm`, com fallback para `criadoEm`;
- cancelamentos, estornos e expirações são excluídos;
- relatório retorna detalhamento por forma, origem, status, dia e produtos;
- datas são tratadas sem antecipar vencimento por UTC.

Execute a sincronização dos modelos/tabelas antes de subir a nova API:

```bash
npm run migrate:mysql
```
