import { IsOptional, IsString, MinLength } from "class-validator";

export class AiChatDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  bindingId?: string;
}
