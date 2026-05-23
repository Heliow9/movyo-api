# Correção dos produtos em destaque na vitrine

O campo correto usado pela API é `destaque` na tabela/modelo `produtos`.

Antes, a rota `PUT /api/produtos/:id/destaque` tentava salvar `produto.destaque`, mas o model MySQL não tinha esse campo em `models/_defs.js`. Por isso o destaque podia aparecer como salvo na tela, mas não persistia nem chegava corretamente na vitrine pública.

## O que foi ajustado

- Adicionado `destaque:bool` no model `Produto`.
- Default `destaque:false`.
- Rotas públicas agora retornam `destaque` normalizado, aceitando `true`, `1`, `"1"`, `"true"`, etc.
- Endpoint `PUT /api/produtos/:id/destaque` agora normaliza corretamente o valor.

## Depois de subir no servidor

Reinicie a API. O próprio sync do model deve criar a coluna automaticamente. Se preferir garantir manualmente no MySQL, rode:

```sql
ALTER TABLE produtos ADD COLUMN destaque TINYINT(1) NULL DEFAULT 0;
```

Se a coluna já existir, ignore o erro de coluna duplicada.

Depois marque novamente o produto como destaque, porque antes esse valor provavelmente não estava sendo persistido no banco.
