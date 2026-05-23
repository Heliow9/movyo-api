# Correção BK unificado balcão

Correções aplicadas:

- A sequência BK agora é única por restaurante para Desktop e app Garçom.
- A API calcula o próximo BK pelo maior `numeroPedido` existente (`BK00001`, `BK00002`...), sem depender do `createdAt/criadoEm`.
- Se o front enviar por engano `pedidoId` de um pedido já pago/em produção, a API não reaproveita: cria novo pedido com próximo BK.
- Mantido fluxo atual de PIX, WhatsApp, produção e pagamentos.

Teste recomendado:

1. Criar balcão no Desktop: deve gerar próximo BK.
2. Criar balcão no app Garçom: deve gerar o próximo BK da mesma sequência.
3. Criar outro balcão no Desktop: deve continuar a sequência.
