# Correção de índices - MySQL 5.6

O erro `Specified key was too long; max key length is 767 bytes` ocorre porque o banco está em MySQL 5.6 com `utf8mb4`.

Em `utf8mb4`, cada caractere pode ocupar até 4 bytes. Um índice em `VARCHAR(255)` pode chegar a 1020 bytes, ultrapassando o limite de 767 bytes do InnoDB no MySQL 5.6.

## O que foi corrigido

Os índices em campos `VARCHAR(255)` agora usam prefixo de 191 caracteres:

```sql
CREATE INDEX idx_exemplo ON tabela (campo(191));
```

Isso mantém compatibilidade com MySQL 5.6 e evita falhas na criação dos índices.

## Observação

O servidor já estava subindo e conectando no MySQL. O problema estava somente na criação dos índices. Com esta versão, os avisos de índice não devem mais aparecer.
