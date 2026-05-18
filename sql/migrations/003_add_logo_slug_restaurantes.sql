-- Adiciona slug relativo da logo na tabela restaurantes (sem apagar dados)
SET NAMES utf8mb4;

ALTER TABLE `restaurantes`
  ADD COLUMN `logoSlug` VARCHAR(255) NULL AFTER `logoUrl`;
