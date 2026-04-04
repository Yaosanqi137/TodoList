import { Transform } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";
import { TaskPriority, TaskStatus } from "../../../generated/prisma/client";

function normalizeString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

export class CreateTaskDto {
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsObject()
  contentJson?: Record<string, unknown>;

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  contentText?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsDateString()
  ddl?: string;

  @Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return value.map((item) => normalizeString(item));
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(30, { each: true })
  tagNames?: string[];
}
