import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import { AttachmentType } from "../../../generated/prisma/client";

function normalizeString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

export class CompleteAttachmentDto {
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  objectKey!: string;

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bucket?: string;

  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1073741824)
  fileSize!: number;

  @IsOptional()
  @IsEnum(AttachmentType)
  type?: AttachmentType;

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  taskId?: string;

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  width?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  height?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86400000)
  durationMs?: number;
}
