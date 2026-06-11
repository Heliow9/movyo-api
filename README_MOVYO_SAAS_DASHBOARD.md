# Movyo SaaS Dashboard

Painel administrativo para cadastrar restaurantes, liberar teste, liberar plano, editar valores dos planos e acompanhar MRR.

Configure a API no build/dev:

```env
VITE_API_BASE_URL=https://sua-api.com/api
```

Planos oficiais:

- free
- starter-mobile
- essencial
- professional
- premium
- full

O plano `free` é o default de novos restaurantes. O plano `full` é reservado para administrador interno do SaaS.
