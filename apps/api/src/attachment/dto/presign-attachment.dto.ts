import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

function normalizeString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

export class PresignAttachmentDto {
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

  @IsInt()
  @Min(1)
  @Max(1073741824)
  fileSize!: number;

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  taskId?: string;
}
