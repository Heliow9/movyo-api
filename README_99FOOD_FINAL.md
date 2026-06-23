# Movyo — Integração 99Food / Open Delivery

## Decisão de produto

A configuração técnica da 99Food deve ficar no painel SaaS da Movyo, por restaurante.
O cliente final no Movyo Desktop vê apenas o status da integração, a loja vinculada e os botões de suporte/teste.

Não foi implementado fluxo de captura de usuário e senha da 99Food. Esse caminho não é recomendado: aumenta risco de segurança, quebra com 2FA/captcha e pode violar regras da plataforma. O caminho correto é usar credenciais oficiais, webhook e autorização/API quando a 99Food liberar o app.

## Fluxo recomendado

1. Admin Movyo acessa Dashboard SaaS > Restaurantes > Editar.
2. Preenche a seção 99Food / Open Delivery:
   - ID da loja / Merchant ID
   - APP ID / Client ID
   - Client Secret
   - Base URL / Ambiente
   - APPShopID
   - Nome da loja
   - Token do webhook
   - Valores em centavos, se aplicável
3. Copia a URL do webhook gerada.
4. Cola no portal da 99Food.
5. Ativa a integração para o restaurante.
6. No Movyo Desktop, o cliente vê a integração como ativa e os pedidos chegam em A Receber.

## Webhook

Endpoint principal:

POST /api/99food/webhook

Alias:

POST /api/food99/webhook

Quando o portal permitir header:

x-99food-token: TOKEN_CONFIGURADO_NO_SAAS

Quando o portal não permitir header, usar na URL:

https://api.movyo.delivery/api/99food/webhook?token=TOKEN_CONFIGURADO_NO_SAAS

## Segurança

O Desktop não salva nem altera APP ID, Secret, token de webhook ou Base URL da 99Food.
Esses campos são bloqueados na API do restaurante e só podem ser gerenciados pelo SaaS.

## Validação executada

- API validada com `node -c` nos controllers/rotas alteradas.
- Dashboard SaaS validado com `npm run build`.
- JSX do Desktop e SaaS validado por parser Babel.

## Implantação

API:

npm run migrate:mysql
npm run perf:indexes
pm2 restart movyo-api

SaaS Dashboard:

npm install
npm run build

Desktop:

npm install
npm run build
