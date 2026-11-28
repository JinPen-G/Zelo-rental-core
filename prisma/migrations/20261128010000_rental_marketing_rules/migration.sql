-- 多规则营销的草稿、不可变发布正文及原操作审计。
-- 仅创建独立新表；不修改旧优惠方案、历史报价、订单或已发券。
-- 本迁移不自动切换计价策略，启用仍需同版应用/消费者与存量核对。
CREATE TABLE `rental_marketing_plans` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `categoryCode` VARCHAR(64) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `revision` INTEGER NOT NULL,
  `draft` JSON NULL,
  `publishedVersion` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_marketing_plan_code` (`tenantId`,`workspaceId`,`code`),
  INDEX `rental_marketing_plan_status` (`tenantId`,`workspaceId`,`status`),
  CONSTRAINT `rental_marketing_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_marketing_plan_versions` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(191) NOT NULL,
  `version` VARCHAR(191) NOT NULL,
  `snapshot` JSON NOT NULL,
  `publishedBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`,`planId`,`version`),
  CONSTRAINT `rental_marketing_version_plan_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`planId`) REFERENCES `rental_marketing_plans` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_marketing_plan_events` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `publishedVersion` VARCHAR(191) NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_marketing_event_revision` (`tenantId`,`workspaceId`,`planId`,`revision`),
  CONSTRAINT `rental_marketing_event_plan_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`planId`) REFERENCES `rental_marketing_plans` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
