-- 空间营销策略显式切换；无记录仍为legacy，不转换任何旧方案或报价。
CREATE TABLE `rental_marketing_pricing_policies` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `policy` VARCHAR(32) NOT NULL,
  `revision` INTEGER NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `updatedBy` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`),
  CONSTRAINT `rental_marketing_policy_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_marketing_pricing_policy_events` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `previousPolicy` VARCHAR(32) NOT NULL,
  `policy` VARCHAR(32) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`,`revision`),
  CONSTRAINT `rental_marketing_policy_event_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `rental_marketing_pricing_policies` (`tenantId`,`workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
