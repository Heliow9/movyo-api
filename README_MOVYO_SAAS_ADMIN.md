# Movyo SaaS Admin

Rotas adicionadas em `/api/saas`:

- `POST /login`
- `GET /planos`
- `PUT /planos/:codigo`
- `GET /restaurantes`
- `POST /restaurantes`
- `PUT /restaurantes/:id`
- `POST /restaurantes/:id/liberar-teste`
- `POST /restaurantes/:id/liberar-plano`

Plano padrão do restaurante: `free`.
Plano `full`: uso interno/administrador SaaS.

Variáveis recomendadas:

```env
SAAS_ADMIN_EMAIL=admin@movyo.delivery
SAAS_ADMIN_SENHA=uma-senha-forte
# ou SAAS_ADMIN_SENHA_HASH=<bcrypt>
```
