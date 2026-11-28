-- 独立人工管控：不改写原资产/工单状态和已应用迁移；原操作收据继续使用 Rental 幂等账。
CREATE TABLE `rental_asset_control_types` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `revision` INTEGER NOT NULL,
  `body` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`workspaceId`, `code`),
  CONSTRAINT `rental_asset_control_types_workspace_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `business_workspaces` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_asset_control_types_revision_check` CHECK (`revision` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_asset_controls` (
  `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `startAt` DATETIME(3) NOT NULL,
  `endedAt` DATETIME(3) NULL,
  `blocksRental` BOOLEAN NOT NULL,
  `workOrderId` VARCHAR(191) NULL,
  `revision` INTEGER NOT NULL,
  `body` JSON NOT NULL,
  `conflicts` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_asset_controls_work_order_key` (`workOrderId`),
  INDEX `rental_asset_controls_scope_asset_status_idx` (`tenantId`, `workspaceId`, `assetId`, `status`, `startAt`),
  CONSTRAINT `rental_asset_controls_workspace_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `business_workspaces` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_asset_controls_asset_fkey` FOREIGN KEY (`assetId`) REFERENCES `rental_assets` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_asset_controls_revision_check` CHECK (`revision` >= 1),
  CONSTRAINT `rental_asset_controls_status_check` CHECK (`status` IN ('active','cancelled','released'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_asset_control_events` (
  `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `objectId` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  `revision` INTEGER NOT NULL,
  `body` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_asset_control_events_revision_key` (`workspaceId`, `objectId`, `revision`),
  CONSTRAINT `rental_asset_control_events_workspace_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `business_workspaces` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
