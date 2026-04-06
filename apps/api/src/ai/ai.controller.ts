import { Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { AiChatDto } from "./dto/ai-chat.dto";
import { UpsertAiProviderBindingDto } from "./dto/upsert-ai-provider-binding.dto";
import { AiChatResponse, AiService, ListAiBindingsResponse } from "./ai.service";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("bindings")
  async listBindings(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined
  ): Promise<ListAiBindingsResponse> {
    return this.aiService.listBindings(this.resolveUserId(userIdHeader));
  }

  @Post("bindings")
  async upsertBinding(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: UpsertAiProviderBindingDto
  ) {
    return this.aiService.upsertBinding(this.resolveUserId(userIdHeader), body);
  }

  @Post("chat")
  async chat(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: AiChatDto
  ): Promise<AiChatResponse> {
    return this.aiService.chat(this.resolveUserId(userIdHeader), body);
  }

  private resolveUserId(userIdHeader: string | string[] | undefined): string {
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
      throw new UnauthorizedException("缺少用户上下文");
    }

    return userId;
  }
}
