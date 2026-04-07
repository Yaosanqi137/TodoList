import { Injectable } from "@nestjs/common";
import { AiChannel } from "../../generated/prisma/client";
import { AstrbotProvider } from "./providers/astrbot.provider";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.provider";
import { AiChannelExecutor } from "./ai.types";

@Injectable()
export class AiProviderRegistryService {
  private readonly executors = new Map<AiChannel, AiChannelExecutor>();

  constructor(
    openAiCompatibleProvider: OpenAiCompatibleProvider,
    astrbotProvider: AstrbotProvider
  ) {
    this.executors.set(AiChannel.USER_KEY, openAiCompatibleProvider);
    this.executors.set(AiChannel.PUBLIC_POOL, openAiCompatibleProvider);
    this.executors.set(AiChannel.ASTRBOT, astrbotProvider);
  }

  getExecutor(channel: AiChannel): AiChannelExecutor {
    const executor = this.executors.get(channel);
    if (!executor) {
      throw new Error(`未找到 ${channel} 对应的 AI 通道执行器`);
    }

    return executor;
  }
}
