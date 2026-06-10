# Ajustes do Bot Movyo

Aplicado em `utils/bot.js`:

- Bot entende perguntas como “qual foi meu último pedido?”, “refazer pedido”, “pedir de novo”.
- Se existir pedido anterior pelo telefone do WhatsApp, mostra resumo e pergunta se deseja refazer.
- Envia botões “Sim, refazer” e “Não”; se o WhatsApp não renderizar botões, aceita resposta por texto: SIM/NÃO.
- Ao confirmar, cria novo pedido com status `aguardando_pagamento`, pagamento `pix`, gera QR Code Mercado Pago e envia ao cliente.
- O pedido só segue o fluxo normal do restaurante quando o webhook/pagamento confirmar, preservando a regra atual.
- Se não houver pedido anterior, informa de forma amigável e envia o link do cardápio.
- Busca de produtos refinada com normalização/fuzzy para casos como `coca cola`, `coca-cola`, `cocacola`, `parmegiana/permegiana`, `hambúrguer/burger`.
- Mensagem de “não encontrei” ficou mais profissional e orienta o cliente a tentar termos parecidos.

Validação feita:

- `node --check utils/bot.js` sem erro de sintaxe.

Ponto de atenção:

- O recurso de refazer pedido depende do restaurante estar conectado ao Mercado Pago e do último pedido possuir itens/total válidos.
