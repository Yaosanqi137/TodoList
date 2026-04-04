import { Transform, Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { TaskPriority, TaskStatus } from "../../../generated/prisma/client";

export enum TaskSortBy {
  CREATED_AT = "createdAt",
  UPDATED_AT = "updatedAt",
  DDL = "ddl"
}

export enum TaskSortOrder {
  ASC = "asc",
  DESC = "desc"
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

export class ListTasksQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => normalizeString(item))
        .filter((item): item is string => item !== undefined);
      return normalized.length > 0 ? normalized : undefined;
    }

    if (typeof value === "string") {
      const normalized = value
        .split(",")
        .map((item) => normalizeString(item))
        .filter((item): item is string => item !== undefined);
      return normalized.length > 0 ? normalized : undefined;
    }

    return undefined;
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(TaskSortBy)
  sortBy?: TaskSortBy;

  @IsOptional()
  @IsEnum(TaskSortOrder)
  sortOrder?: TaskSortOrder;
}
