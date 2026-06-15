# Implantação integrada — Movyo 2.2.0

## Ordem recomendada

1. Faça backup do banco e da API atual.
2. Publique a API.
3. Execute a migração do banco.
4. Reinicie a API e valide `/health` ou uma rota de autenticação.
5. Publique o Dashboard SaaS.
6. Teste relatórios e auditoria com um restaurante de homologação.
7. Gere e publique o instalador do Desktop.

## API

```bash
cd /caminho/api-movyo
npm install
npm run migrate:mysql
pm2 restart api-movyo
pm2 logs api-movyo --lines 100
```

A migração cria/atualiza a tabela de auditoria e o campo JSON de permissões dos operadores. Operadores antigos continuam funcionando com permissões padrão compatíveis.

## Dashboard SaaS

```bash
cd /caminho/movyo-saas-dashboard
npm install
npm run build
```

Publique o conteúdo da pasta `dist/` no diretório servido pelo Nginx e recarregue:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Desktop

O projeto está na versão `2.2.0`. Para gerar uma nova publicação:

```powershell
npm install
$env:GH_TOKEN="TOKEN_TEMPORARIO"
npm run dist:publish
```

Para atualização obrigatória, inclua `[OBRIGATORIA]` nas notas da Release. Sem essa marca, a atualização é baixada em segundo plano e o usuário escolhe quando reiniciar.

Não coloque `GH_TOKEN` no código, no `.env` distribuído ou no instalador. Para clientes finais, prefira um repositório público exclusivo de artefatos ou um servidor de atualização próprio.

## Critério financeiro padronizado

Faturamento, ticket médio, formas de pagamento, origem, produtos e evolução temporal consideram somente vendas confirmadas. Pedidos cancelados, expirados, estornados, reembolsados ou ainda pendentes permanecem consultáveis, mas não entram na receita.

A data financeira usa `pagoEm` quando disponível e `criadoEm` como fallback para pedidos operacionais já confirmados.

## Validação pós-implantação

- bloquear um restaurante e confirmar o encerramento da sessão;
- vencer uma licença de homologação e testar a tela de regularização;
- desconectar a internet e validar a tolerância offline de até 12 horas após a última validação válida;
- desligar a impressora, gerar um pedido e conferir a fila/reprocessamento;
- reiniciar o Socket e confirmar a recuperação dos pedidos pela API;
- criar operador com permissões restritas e testar caixa/movimentação/fechamento;
- comparar o faturamento do Desktop e do Dashboard no mesmo período;
- conferir os registros em **Auditoria** no Dashboard.

## Rollback

Em caso de falha crítica, restaure a versão anterior da API e do Dashboard. A nova tabela de auditoria e o campo de permissões podem permanecer no banco, pois são aditivos. No Desktop, mantenha a Release anterior disponível para reinstalação manual durante a homologação.
