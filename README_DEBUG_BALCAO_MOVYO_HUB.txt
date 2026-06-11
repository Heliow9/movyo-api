DEBUG BALCÃO - Movyo Hub

Este pacote adiciona logs no app para saber se o timeout ocorre na abertura do pedido, no pagamento ou no PIX.

Arquivos alterados no Hub:
- src/api/api.js
- src/screens/BalcaoScreen.js

Logs no console/Metro/Expo:
[HUB_API][BALCAO][REQUEST]
[HUB_API][BALCAO][RESPONSE]
[HUB_API][BALCAO][ERROR]
[BALCAO_SCREEN] Enviando abertura do pedido
[BALCAO_SCREEN] Resposta abertura recebida
[BALCAO_SCREEN] Enviando pagamento balcão
[BALCAO_SCREEN] Pagamento balcão confirmado pela API
[BALCAO_SCREEN] ERRO finalizar
