import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AiRateLimitService } from "./ai-rate-limit.service";
import { AiController } from "./ai.controller";
import { AiProviderRegistryService } from "./ai-provider-registry.service";
import { AiService } from "./ai.service";
import { AstrbotProvider } from "./providers/astrbot.provider";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.provider";

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiRateLimitService,
    AiProviderRegistryService,
    OpenAiCompatibleProvider,
    AstrbotProvider
  ]
})
export class AiModule {}
