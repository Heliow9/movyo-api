-- Movyo API MySQL - schema coluna por coluna
-- Compatível com MySQL 5.6 / utf8mb4
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `restaurantes` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `nome` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `senha` VARCHAR(255) NULL,
  `cnpj` VARCHAR(255) NULL,
  `enderecoCep` VARCHAR(255) NULL,
  `enderecoRua` VARCHAR(255) NULL,
  `enderecoNumero` VARCHAR(255) NULL,
  `enderecoBairro` VARCHAR(255) NULL,
  `enderecoCidade` VARCHAR(255) NULL,
  `enderecoEstado` VARCHAR(255) NULL,
  `telefone` VARCHAR(255) NULL,
  `logoUrl` TEXT NULL,
  `logoSlug` VARCHAR(255) NULL,
  `horariosFuncionamento` LONGTEXT NULL,
  `tempoMedioEntregaMin` DOUBLE NULL,
  `maxPedidosPorEntregador` DOUBLE NULL,
  `pedidosPorEntregador` DOUBLE NULL,
  `anotaaiStatus` TINYINT(1) NULL,
  `anotaaiUrl` TEXT NULL,
  `anotaaiIdentificador` VARCHAR(255) NULL,
  `anotaaiToken` TEXT NULL,
  `ifoodStatus` TINYINT(1) NULL,
  `ifoodIdentificador` VARCHAR(255) NULL,
  `ifoodPrecisaConfirmacao` TINYINT(1) NULL,
  `ifoodIgnorarPronto` TINYINT(1) NULL,
  `ifood` LONGTEXT NULL,
  `localizacao` LONGTEXT NULL,
  `statusBot` LONGTEXT NULL,
  `ativo` TINYINT(1) NULL,
  `mensagensPersonalizadas` LONGTEXT NULL,
  `chavePix` VARCHAR(255) NULL,
  `recipient_id` VARCHAR(255) NULL,
  `mercadoPago` LONGTEXT NULL,
  `pagamentoCartaoAtivo` TINYINT(1) NULL,
  `taxaCartaoCreditoAvistaPercent` DECIMAL(12,2) NULL,
  `garcons` LONGTEXT NULL,
  `plano` VARCHAR(255) NULL,
  `slugIdentificador` VARCHAR(255) NULL,
  `dataCadastro` DATETIME NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_restaurantes_email ON restaurantes (email(191));
CREATE INDEX idx_restaurantes_slug ON restaurantes (slugIdentificador(191));

CREATE TABLE IF NOT EXISTS `produtos` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restaurante` VARCHAR(24) NULL,
  `categoria` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `descricao` TEXT NULL,
  `preco` DECIMAL(12,2) NULL,
  `imagem` TEXT NULL,
  `ativo` TINYINT(1) NULL,
  `ordem` DOUBLE NULL,
  `tempoPreparoMin` DOUBLE NULL,
  `imprimeNaCozinha` TINYINT(1) NULL,
  `mercadoPagoCategoryId` VARCHAR(255) NULL,
  `extras` LONGTEXT NULL,
  `estoque` LONGTEXT NULL,
  `sabores` LONGTEXT NULL,
  `bordas` LONGTEXT NULL,
  `adicionais` LONGTEXT NULL,
  `complementos` LONGTEXT NULL,
  `tipo` VARCHAR(255) NULL,
  `disponivel` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_produtos_restaurante ON produtos (restaurante);
CREATE INDEX idx_produtos_categoria ON produtos (categoria);

CREATE TABLE IF NOT EXISTS `categorias_produto` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restaurante` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `slug` VARCHAR(255) NULL,
  `permiteSabores` TINYINT(1) NULL,
  `maxSabores` DOUBLE NULL,
  `permiteBordas` TINYINT(1) NULL,
  `permiteAdicionais` TINYINT(1) NULL,
  `permiteComplementos` TINYINT(1) NULL,
  `saboresDisponiveis` LONGTEXT NULL,
  `bordasDisponiveis` LONGTEXT NULL,
  `adicionaisDisponiveis` LONGTEXT NULL,
  `complementosDisponiveis` LONGTEXT NULL,
  `ordem` DOUBLE NULL,
  `tiposExtras` LONGTEXT NULL,
  `ativa` TINYINT(1) NULL,
  `pizzaMultisabor` TINYINT(1) NULL,
  `calculoPrecoPor` VARCHAR(255) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_categorias_restaurante ON categorias_produto (restaurante);

CREATE TABLE IF NOT EXISTS `pedidos` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `numeroPedido` DOUBLE NULL,
  `restaurante` VARCHAR(24) NULL,
  `cliente` VARCHAR(24) NULL,
  `entregador` VARCHAR(24) NULL,
  `mesaId` VARCHAR(24) NULL,
  `mesaNumero` VARCHAR(255) NULL,
  `nomeCliente` VARCHAR(255) NULL,
  `telefoneCliente` VARCHAR(255) NULL,
  `enderecoCliente` TEXT NULL,
  `itens` LONGTEXT NULL,
  `total` DECIMAL(12,2) NULL,
  `taxaEntrega` DECIMAL(12,2) NULL,
  `formaPagamento` VARCHAR(255) NULL,
  `status` VARCHAR(255) NULL,
  `statusPagamento` VARCHAR(255) NULL,
  `origem` VARCHAR(255) NULL,
  `observacao` TEXT NULL,
  `pagamento` LONGTEXT NULL,
  `mpPaymentId` VARCHAR(255) NULL,
  `mpPreferenceId` VARCHAR(255) NULL,
  `qrCode` TEXT NULL,
  `qrCodeBase64` TEXT NULL,
  `pixCopiaECola` TEXT NULL,
  `criadoEm` DATETIME NULL,
  `entregueEm` DATETIME NULL,
  `canceladoEm` DATETIME NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pedidos_restaurante ON pedidos (restaurante);
CREATE INDEX idx_pedidos_status ON pedidos (status(191));
CREATE INDEX idx_pedidos_entregador ON pedidos (entregador);

CREATE TABLE IF NOT EXISTS `clientes` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `nome` VARCHAR(255) NULL,
  `telefone` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `enderecos` LONGTEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_clientes_telefone ON clientes (telefone(191));

CREATE TABLE IF NOT EXISTS `entregadores` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `nome` VARCHAR(255) NULL,
  `email` VARCHAR(255) NULL,
  `senha` VARCHAR(255) NULL,
  `cpf` VARCHAR(255) NULL,
  `restaurante` VARCHAR(24) NULL,
  `localizacao` LONGTEXT NULL,
  `entregas` LONGTEXT NULL,
  `disponivel` TINYINT(1) NULL,
  `status` TINYINT(1) NULL,
  `statusConta` VARCHAR(255) NULL,
  `expoPushToken` TEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_entregadores_email ON entregadores (email(191));
CREATE UNIQUE INDEX idx_entregadores_cpf ON entregadores (cpf(191));
CREATE INDEX idx_entregadores_restaurante ON entregadores (restaurante);

CREATE TABLE IF NOT EXISTS `entregadores_online` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `entregadorId` VARCHAR(24) NULL,
  `restauranteId` VARCHAR(24) NULL,
  `dataEntrada` DATETIME NULL,
  `dia` VARCHAR(255) NULL,
  `online` TINYINT(1) NULL,
  `localizacao` LONGTEXT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_entregadores_online_restaurante ON entregadores_online (restauranteId);

CREATE TABLE IF NOT EXISTS `mesas` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `numero` VARCHAR(255) NULL,
  `restauranteId` VARCHAR(24) NULL,
  `qrCodeIdentifier` VARCHAR(255) NULL,
  `status` VARCHAR(255) NULL,
  `pedidoAtualId` VARCHAR(24) NULL,
  `sessaoToken` VARCHAR(255) NULL,
  `sessaoExpiraEm` DATETIME NULL,
  `sessaoInicialExpiraEm` DATETIME NULL,
  `ocupadaDesde` DATETIME NULL,
  `ultimaFechadaEm` DATETIME NULL,
  `ultimaPermanenciaSegundos` DOUBLE NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_mesas_qr ON mesas (qrCodeIdentifier(191));
CREATE INDEX idx_mesas_restaurante ON mesas (restauranteId);

CREATE TABLE IF NOT EXISTS `pedidos_mesa` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `mesaId` VARCHAR(24) NULL,
  `mesaNumero` VARCHAR(255) NULL,
  `restauranteId` VARCHAR(24) NULL,
  `itens` LONGTEXT NULL,
  `valorTotal` DECIMAL(12,2) NULL,
  `status` VARCHAR(255) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pedidos_mesa_restaurante ON pedidos_mesa (restauranteId);

CREATE TABLE IF NOT EXISTS `fretes` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restaurante` VARCHAR(24) NULL,
  `tipo` VARCHAR(255) NULL,
  `taxaFixa` DECIMAL(12,2) NULL,
  `valorPorKm` DECIMAL(12,2) NULL,
  `raioKm` DOUBLE NULL,
  `areas` LONGTEXT NULL,
  `ativo` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_fretes_restaurante ON fretes (restaurante);

CREATE TABLE IF NOT EXISTS `insumos` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restauranteId` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `baseUnit` VARCHAR(255) NULL,
  `estoqueAtualBase` DOUBLE NULL,
  `estoqueMinimoBase` DOUBLE NULL,
  `custoMedioBase` DECIMAL(12,2) NULL,
  `ativo` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_insumos_restaurante ON insumos (restauranteId);

CREATE TABLE IF NOT EXISTS `movimentos_estoque` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restauranteId` VARCHAR(24) NULL,
  `insumoId` VARCHAR(24) NULL,
  `tipo` VARCHAR(255) NULL,
  `quantidadeBase` DOUBLE NULL,
  `custoUnitarioBase` DECIMAL(12,2) NULL,
  `origem` VARCHAR(255) NULL,
  `referenciaId` VARCHAR(24) NULL,
  `observacao` TEXT NULL,
  `data` DATETIME NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_movimentos_restaurante ON movimentos_estoque (restauranteId);
CREATE INDEX idx_movimentos_insumo ON movimentos_estoque (insumoId);

CREATE TABLE IF NOT EXISTS `receitas` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restauranteId` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `itens` LONGTEXT NULL,
  `ativo` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_receitas_restaurante ON receitas (restauranteId);

CREATE TABLE IF NOT EXISTS `oauth_states` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `state` VARCHAR(255) NULL,
  `restauranteId` VARCHAR(24) NULL,
  `provider` VARCHAR(255) NULL,
  `codeVerifier` TEXT NULL,
  `redirectUri` TEXT NULL,
  `expiresAt` DATETIME NULL,
  `usado` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_oauth_state ON oauth_states (state(191));

CREATE TABLE IF NOT EXISTS `imagens_favoritas` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `restauranteId` VARCHAR(24) NULL,
  `url` TEXT NULL,
  `tipo` VARCHAR(255) NULL,
  `metadata` LONGTEXT NULL,
  `ativo` TINYINT(1) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_imagens_restaurante ON imagens_favoritas (restauranteId);

CREATE TABLE IF NOT EXISTS `adicionais` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `produto` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `preco` DECIMAL(12,2) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_adicionais_produto ON adicionais (produto);

CREATE TABLE IF NOT EXISTS `bordas` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `produto` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `preco` DECIMAL(12,2) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_bordas_produto ON bordas (produto);

CREATE TABLE IF NOT EXISTS `complementos` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `produto` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `preco` DECIMAL(12,2) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_complementos_produto ON complementos (produto);

CREATE TABLE IF NOT EXISTS `sabores` (
  `id` VARCHAR(24) NOT NULL PRIMARY KEY,
  `produto` VARCHAR(24) NULL,
  `nome` VARCHAR(255) NULL,
  `preco` DECIMAL(12,2) NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sabores_produto ON sabores (produto);

