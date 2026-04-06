import { AiChannel } from "../../../generated/prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MinLength } from "class-validator";

export class UpsertAiProviderBindingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  id?: string;

  @IsEnum(AiChannel)
  channel!: AiChannel;

  @IsOptional()
  @IsString()
  @MinLength(1)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  model?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  configId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  configName?: string;

  @IsOptional()
  @IsUrl(
    {
      require_tld: false
    },
    {
      message: "endpoint 必须是合法的 URL"
    }
  )
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
