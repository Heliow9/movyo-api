# Ajustes SaaS Movyo

Incluído:
- Dashboard SaaS filtrável por restaurante e período.
- Botão de setar plano imediato por 30 dias.
- Bloqueio automático quando `dataFimPlano` vence.
- Invalidação automática de sessão quando plano/status/vencimento/ativo muda.
- Campo `sessaoVersao` em restaurantes.

Ao alterar plano pelo SaaS, a API incrementa `sessaoVersao`. Tokens antigos de restaurante e garçom passam a retornar `SESSAO_ATUALIZADA`, forçando novo login.
