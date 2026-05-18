# Movyo API — Migração correta para MySQL

Esta versão remove a dependência operacional do MongoDB e usa MySQL como banco principal.

## O que foi feito

- Conexão MySQL em `db/mysql.js`.
- Tabelas criadas coluna por coluna, com `VARCHAR`, `DECIMAL`, `DOUBLE`, `TINYINT`, `DATETIME`, `TEXT` e `LONGTEXT`.
- Compatível com MySQL 5.6, por isso campos estruturados usam `LONGTEXT` serializado, não `JSON` nativo.
- Mantidas as rotas existentes.
- Mantido Socket.IO.
- Mantidos os IDs estilo ObjectId de 24 caracteres para não quebrar front/app/desktop.
- Adicionado `npm run migrate:mysql` para sincronizar as tabelas.
- SQL completo em `sql/migrations/001_schema_mysql_coluna_por_coluna.sql`.

## Configuração

Crie `.env` com:

```env
PORT=10000
MYSQL_HOST=movyo.mysql.uhserver.com
MYSQL_PORT=3306
MYSQL_DATABASE=movyo
MYSQL_USER=movyo_admin
MYSQL_PASSWORD=22021419hH*
MYSQL_CONNECTION_LIMIT=10
JWT_SECRET=troque_essa_chave_em_producao
```

## Rodar

```bash
npm install
npm run migrate:mysql
npm start
```

## Observação importante

Esta versão foi feita para evitar crashs na migração mantendo compatibilidade com as rotas atuais. A estrutura agora é SQL por tabela/coluna, sem depender de MongoDB para persistência. Em uma próxima etapa, o ideal é converter controller por controller para SQL puro, mas esta entrega já troca o armazenamento principal para MySQL e preserva funcionamento das chamadas atuais.
