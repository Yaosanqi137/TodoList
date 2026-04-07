import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import { AiChatDto } from "./dto/ai-chat.dto";
import { ListAiUsageLogsQueryDto } from "./dto/list-ai-usage-logs-query.dto";
import { UpsertAiProviderBindingDto } from "./dto/upsert-ai-provider-binding.dto";
import {
  AiChatResponse,
  AiService,
  ListAiBindingsResponse,
  ListAiUsageLogsResponse,
  TestAiBindingResponse
} from "./ai.service";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("bindings")
  async listBindings(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined
  ): Promise<ListAiBindingsResponse> {
    return this.aiService.listBindings(this.resolveUserId(userIdHeader));
  }

  @Get("usage-logs")
  async listUsageLogs(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Query() query: ListAiUsageLogsQueryDto
  ): Promise<ListAiUsageLogsResponse> {
    return this.aiService.listUsageLogs(this.resolveUserId(userIdHeader), query);
  }

  @Post("bindings")
  async upsertBinding(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: UpsertAiProviderBindingDto
  ) {
    return this.aiService.upsertBinding(this.resolveUserId(userIdHeader), body);
  }

  @Post("bindings/test")
  async testBinding(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: UpsertAiProviderBindingDto
  ): Promise<TestAiBindingResponse> {
    return this.aiService.testBinding(this.resolveUserId(userIdHeader), body);
  }

  @Post("chat")
  async chat(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Ip() clientIp: string,
    @Body() body: AiChatDto
  ): Promise<AiChatResponse> {
    return this.aiService.chat(this.resolveUserId(userIdHeader), body, clientIp);
  }

  private resolveUserId(userIdHeader: string | string[] | undefined): string {
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
      throw new UnauthorizedException("缺少用户上下文");
    }

    return userId;
  }
}
