# Ajuste: caixa atual e fuso horário

- Totais e quantidade de pedidos agora são calculados exclusivamente por `caixaSessaoId`.
- Um caixa fechado, ainda que tenha atravessado a meia-noite, não entra nos KPIs do caixa seguinte.
- `caixaAtual` passa a retornar `totalPedidos` da sessão aberta.
- MySQL configurado com `timezone=-03:00`, corrigindo a leitura de DATETIME em servidores Linux UTC.
- Exemplo: `2026-06-15 19:13:00` passa a representar corretamente 19:13 no Brasil, e não 19:13 UTC.
