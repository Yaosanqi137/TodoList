import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { AiChannel } from "../../../generated/prisma/client";

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
}
