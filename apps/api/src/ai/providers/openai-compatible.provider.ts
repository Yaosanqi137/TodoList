import { Injectable } from "@nestjs/common";
import {
  AiChannelExecutor,
  AiChatInput,
  AiChatResult,
  AiResolvedRouteCandidate,
  AiRouteFailureError
} from "../ai.types";

@Injectable()
export class OpenAiCompatibleProvider implements AiChannelExecutor {
  async execute(candidate: AiResolvedRouteCandidate, input: AiChatInput): Promise<AiChatResult> {
    if (!candidate.endpoint) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "MISSING_ENDPOINT",
        "缺少 AI 服务地址配置"
      );
    }

    if (!candidate.apiKey) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "MISSING_API_KEY",
        "缺少 AI 服务密钥配置"
      );
    }

    if (!candidate.model) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "MISSING_MODEL",
        "缺少 AI 模型配置"
      );
    }

    const requestUrl = this.buildRequestUrl(candidate.endpoint);

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${candidate.apiKey}`
        },
        body: JSON.stringify({
          model: candidate.model,
          messages: [
            {
              role: "user",
              content: input.message
            }
          ],
          stream: false
        }),
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "UPSTREAM_UNREACHABLE",
        this.toErrorMessage(error, "AI 服务请求失败")
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "INVALID_RESPONSE",
        this.toErrorMessage(error, "AI 服务返回了无法解析的数据")
      );
    }

    if (!response.ok) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        `UPSTREAM_HTTP_${response.status}`,
        this.extractErrorMessage(payload, `AI 服务调用失败，状态码 ${response.status}`)
      );
    }

    const content = this.extractAssistantText(payload);
    if (!content.trim()) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName,
        "EMPTY_RESPONSE",
        "AI 服务没有返回有效内容"
      );
    }

    return {
      channel: candidate.channel,
      providerName: candidate.providerName,
      model: this.extractModel(payload) ?? candidate.model,
      content,
      sessionId: input.sessionId,
      raw: payload
    };
  }

  private buildRequestUrl(endpoint: string): string {
    const normalizedEndpoint = endpoint.replace(/\/+$/, "");
    if (normalizedEndpoint.endsWith("/chat/completions")) {
      return normalizedEndpoint;
    }
    if (normalizedEndpoint.endsWith("/v1")) {
      return `${normalizedEndpoint}/chat/completions`;
    }
    return `${normalizedEndpoint}/v1/chat/completions`;
  }

  private extractAssistantText(payload: unknown): string {
    if (!this.isRecord(payload)) {
      return "";
    }

    const choices = payload["choices"];
    if (!Array.isArray(choices) || choices.length === 0) {
      return "";
    }

    const firstChoice = choices[0];
    if (!this.isRecord(firstChoice)) {
      return "";
    }

    const message = firstChoice["message"];
    if (!this.isRecord(message)) {
      return "";
    }

    return this.extractMessageContent(message["content"]);
  }

  private extractMessageContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .map((item) => {
        if (!this.isRecord(item)) {
          return "";
        }

        if (typeof item["text"] === "string") {
          return item["text"];
        }

        return "";
      })
      .filter((item) => item.length > 0)
      .join("\n");
  }

  private extractModel(payload: unknown): string | null {
    if (!this.isRecord(payload) || typeof payload["model"] !== "string") {
      return null;
    }

    return payload["model"];
  }

  private extractErrorMessage(payload: unknown, fallback: string): string {
    if (!this.isRecord(payload)) {
      return fallback;
    }

    const error = payload["error"];
    if (!this.isRecord(error) || typeof error["message"] !== "string") {
      return fallback;
    }

    return error["message"];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
