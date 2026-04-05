import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export enum SyncEntityTypeDto {
  TASK = "TASK"
}

export enum SyncActionTypeDto {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE"
}

export class SyncPushOperationDto {
  @IsString()
  @MaxLength(64)
  opId!: string;

  @IsString()
  @MaxLength(64)
  entityId!: string;

  @IsEnum(SyncEntityTypeDto)
  entityType!: SyncEntityTypeDto;

  @IsEnum(SyncActionTypeDto)
  action!: SyncActionTypeDto;

  @IsOptional()
  @IsString()
  @MaxLength(5000000)
  payload?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  clientTs!: number;

  @IsString()
  @MaxLength(128)
  deviceId!: string;
}

export class SyncPushDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SyncPushOperationDto)
  operations!: SyncPushOperationDto[];
}
