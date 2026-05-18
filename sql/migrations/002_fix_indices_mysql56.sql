-- Correção de índices para MySQL 5.6 + utf8mb4
-- MySQL 5.6 possui limite de 767 bytes por chave em InnoDB.
-- Em utf8mb4, VARCHAR(255) pode usar até 1020 bytes, então os índices usam prefixo de 191 caracteres.

CREATE UNIQUE INDEX idx_restaurantes_email ON restaurantes (email(191));
CREATE INDEX idx_restaurantes_slug ON restaurantes (slugIdentificador(191));
CREATE INDEX idx_pedidos_status ON pedidos (status(191));
CREATE UNIQUE INDEX idx_clientes_telefone ON clientes (telefone(191));
CREATE UNIQUE INDEX idx_entregadores_email ON entregadores (email(191));
CREATE UNIQUE INDEX idx_entregadores_cpf ON entregadores (cpf(191));
CREATE UNIQUE INDEX idx_mesas_qr ON mesas (qrCodeIdentifier(191));
CREATE UNIQUE INDEX idx_oauth_state ON oauth_states (state(191));
