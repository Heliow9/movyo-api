ALTER TABLE pedidos
  ADD COLUMN externalOrderType VARCHAR(255) NULL,
  ADD COLUMN externalOrderTiming VARCHAR(255) NULL,
  ADD COLUMN deliveryProvider VARCHAR(255) NULL,
  ADD COLUMN pickupCode VARCHAR(255) NULL,
  ADD COLUMN deliveryLocalizer VARCHAR(255) NULL,
  ADD COLUMN deliveryObservations LONGTEXT NULL,
  ADD COLUMN scheduledTo DATETIME NULL,
  ADD COLUMN ifoodPreparationStartAt DATETIME NULL,
  ADD COLUMN ifoodReadyAt DATETIME NULL,
  ADD COLUMN ifoodDispatchedAt DATETIME NULL,
  ADD COLUMN ifoodCancellationStatus VARCHAR(255) NULL,
  ADD COLUMN ifoodCancellationReason VARCHAR(255) NULL,
  ADD COLUMN ifoodDriver LONGTEXT NULL,
  ADD COLUMN ifoodTracking LONGTEXT NULL;

DROP INDEX idx_pedidos_external ON pedidos;
CREATE UNIQUE INDEX uq_pedidos_external ON pedidos (restaurante, origem(32), externalOrderId(191));

CREATE TABLE IF NOT EXISTS ifood_events (
  id CHAR(24) NOT NULL PRIMARY KEY,
  eventId VARCHAR(255) NOT NULL,
  restauranteId CHAR(24) NULL,
  merchantId VARCHAR(255) NULL,
  orderId VARCHAR(255) NULL,
  code VARCHAR(255) NULL,
  payload LONGTEXT NULL,
  status VARCHAR(255) NULL,
  tentativas DOUBLE DEFAULT 0,
  ultimoErro LONGTEXT NULL,
  recebidoEm DATETIME NULL,
  processadoEm DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ifood_event_id (eventId(191)),
  KEY idx_ifood_event_status (status(32), recebidoEm),
  KEY idx_ifood_event_order (restauranteId, orderId(191))
);
