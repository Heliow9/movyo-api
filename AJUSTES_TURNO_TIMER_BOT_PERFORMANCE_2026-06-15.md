# Ajustes turno, timer, bot e performance

- Persistência MySQL adicionada para aceitoEm, emProducaoEm, emEntregaEm, statusAtualizadoEm e dataOperacional.
- Vínculo ao caixa não marca mais o pedido como aceito automaticamente.
- Listagem de pedidos executa count e rows em paralelo.
- Índices adicionados para restaurante/data/status/caixa.
- Aliases createdAt/updatedAt normalizados na resposta SQL.
