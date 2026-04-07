import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested
} from "class-validator";
import { AiChannel } from "../../../generated/prisma/client";
import { TaskPriority, TaskStatus } from "../../../generated/prisma/client";

export class LocalTaskContextItemDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsEnum(TaskPriority)
  priority!: TaskPriority;

  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @IsOptional()
  @IsInt()
  ddlAt?: number | null;

  @IsOptional()
  @IsString()
  contentText?: string | null;

  @IsInt()
  updatedAt!: number;
}

export class AiChatDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sessionId?: string;

  @IsOptional()
  @IsEnum(AiChannel)
  channel?: AiChannel;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalTaskContextItemDto)
  localTasks?: LocalTaskContextItemDto[];
}
