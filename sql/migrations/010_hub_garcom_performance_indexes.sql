-- ==========================================
-- MOVYO - Migration 010
-- Performance Movyo Hub / App Garçom
-- Compatível com MySQL antigo usando prefixo em VARCHAR(255)
-- ==========================================

-- Pedidos do dia por restaurante, listagem e resumo do Hub
CREATE INDEX idx_pedidos_rest_criado_id
ON pedidos (restaurante, criadoEm, id);

-- Fila/status do Hub por restaurante + status + data
CREATE INDEX idx_pedidos_rest_status_criado_id
ON pedidos (restaurante, status(30), criadoEm, id);

-- Filtro de origem, útil para balcão/mesa/delivery
CREATE INDEX idx_pedidos_rest_origem_criado_id
ON pedidos (restaurante, origem(30), criadoEm, id);

-- Mesas do restaurante na Home do Hub
CREATE INDEX idx_mesas_rest_status_numero
ON mesas (restauranteId, status(30), numero(30));
