/** 人工管控HTTP输入；当前身份、配置、库存及原工单验收仍由原事务核定。 */
import { Type } from "class-transformer";
import { Equals, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { RENTAL_WORK_ORDER_TYPES, type RentalWorkOrderType } from "./contracts";
import type { RentalAssetControlType } from "./asset-controls";
export class AssetControlCommandDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) operationId!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Matches(/\S/u) @MaxLength(500) reason!: string;
}
export class CreateAssetControlDto extends AssetControlCommandDto {
  @IsString() @IsNotEmpty() @MaxLength(191) assetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) typeCode!: string;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsISO8601() plannedEndAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) assigneeId?: string;
}
export class EmergencyAssetControlDto extends CreateAssetControlDto { @Equals(true) confirmed!: true; }
export class ExtendAssetControlDto extends AssetControlCommandDto { @IsISO8601() plannedEndAt!: string; }
export class AssetControlTypeDto implements Omit<RentalAssetControlType, "revision"> {
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u) code!: string;
  @IsString() @Matches(/\S/u) @MaxLength(191) name!: string;
  @IsBoolean() enabled!: boolean;
  @IsBoolean() blocksRental!: boolean;
  @IsBoolean() requiresWorkOrder!: boolean;
  @IsBoolean() releaseRequiresAcceptance!: boolean;
  @IsOptional() @IsIn(RENTAL_WORK_ORDER_TYPES) workOrderType?: RentalWorkOrderType;
}
export class SaveAssetControlTypeDto extends AssetControlCommandDto {
  @IsDefined() @ValidateNested() @Type(() => AssetControlTypeDto) type!: AssetControlTypeDto;
}
