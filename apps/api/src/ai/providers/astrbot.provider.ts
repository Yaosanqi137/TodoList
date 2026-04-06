import { Injectable } from "@nestjs/common";
import {
  AiChannelExecutor,
  AiChatInput,
  AiChatResult,
  AiResolvedRouteCandidate,
  AiRouteFailureError
} from "../ai.types";

@Injectable()
export class AstrbotProvider implements AiChannelExecutor {
  async execute(candidate: AiResolvedRouteCandidate, input: AiChatInput): Promise<AiChatResult> {
    const routeLabel =
      candidate.providerName || candidate.configName || candidate.configId || "astrbot";

    if (!candidate.endpoint) {
      throw new AiRouteFailureError(
        candidate.channel,
        routeLabel,
        "MISSING_ENDPOINT",
        "缺少 AstrBot 服务地址配置"
      );
    }

    if (!candidate.apiKey) {
      throw new AiRouteFailureError(
        candidate.channel,
        routeLabel,
        "MISSING_API_KEY",
        "缺少 AstrBot API Key 配置"
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
          username: input.userId,
          session_id: input.sessionId ?? undefined,
          message: input.message,
          enable_streaming: false,
          config_id: candidate.configId ?? undefined,
          config_name: candidate.configName ?? undefined,
          selected_provider: candidate.providerName || undefined,
          selected_model: candidate.model ?? undefined
        }),
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      throw new AiRouteFailureError(
        candidate.channel,
        routeLabel,
        "UPSTREAM_UNREACHABLE",
        this.toErrorMessage(error, "AstrBot 服务请求失败")
      );
    }

    if (!response.ok) {
      const rawText = await response.text();
      throw new AiRouteFailureError(
        candidate.channel,
        routeLabel,
        `UPSTREAM_HTTP_${response.status}`,
        this.extractHttpErrorMessage(rawText, response.status)
      );
    }

    const events = await this.readSseEvents(response);
    let content = "";
    let sessionId = input.sessionId;

    for (const event of events) {
      const type = this.readString(event["type"]);
      if (type === "session_id") {
        sessionId = this.readString(event["session_id"]) ?? sessionId;
        continue;
      }

      if (type === "error") {
        throw new AiRouteFailureError(
          candidate.channel,
          routeLabel,
          this.readString(event["code"]) ?? "ASTRBOT_ERROR",
          this.readString(event["data"]) ?? "AstrBot 返回错误"
        );
      }

      if (type !== "plain") {
        continue;
      }

      const chainType = this.readString(event["chain_type"]);
      if (
        chainType === "reasoning" ||
        chainType === "tool_call" ||
        chainType === "tool_call_result"
      ) {
        continue;
      }

      const data = this.readString(event["data"]);
      if (!data) {
        continue;
      }

      if (event["streaming"] === true) {
        content += data;
        continue;
      }

      content = data;
    }

    if (!content.trim()) {
      throw new AiRouteFailureError(
        candidate.channel,
        routeLabel,
        "EMPTY_RESPONSE",
        "AstrBot 没有返回有效内容"
      );
    }

    return {
      channel: candidate.channel,
      providerName: routeLabel,
      model: candidate.model,
      content,
      sessionId,
      raw: events
    };
  }

  private buildRequestUrl(endpoint: string): string {
    const normalizedEndpoint = endpoint.replace(/\/+$/, "");
    if (normalizedEndpoint.endsWith("/api/v1/chat")) {
      return normalizedEndpoint;
    }
    if (normalizedEndpoint.endsWith("/api/v1")) {
      return `${normalizedEndpoint}/chat`;
    }
    if (normalizedEndpoint.endsWith("/api")) {
      return `${normalizedEndpoint}/v1/chat`;
    }
    return `${normalizedEndpoint}/api/v1/chat`;
  }

  private parseSseEvents(rawText: string): Array<Record<string, unknown>> {
    return rawText
      .split(/\r?\n\r?\n/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
      )
      .filter((payload) => payload.length > 0)
      .map((payload) => {
        try {
          return JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);
  }

  private async readSseEvents(response: Response): Promise<Array<Record<string, unknown>>> {
    if (!response.body) {
      return this.parseSseEvents(await response.text());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events: Array<Record<string, unknown>> = [];
    let buffer = "";
    let reachedEndEvent = false;

    try {
      while (!reachedEndEvent) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split(/\r?\n\r?\n/);
        buffer = segments.pop() ?? "";

        for (const segment of segments) {
          const parsedEvents = this.parseSseEvents(segment);
          for (const event of parsedEvents) {
            events.push(event);
            if (this.readString(event["type"]) === "end") {
              reachedEndEvent = true;
              break;
            }
          }

          if (reachedEndEvent) {
            break;
          }
        }
      }

      const tail = `${buffer}${decoder.decode()}`;
      if (tail.trim().length > 0) {
        events.push(...this.parseSseEvents(tail));
      }
    } finally {
      await reader.cancel();
    }

    return events;
  }

  private extractHttpErrorMessage(rawText: string, statusCode: number): string {
    try {
      const payload = JSON.parse(rawText) as Record<string, unknown>;
      if (typeof payload["message"] === "string") {
        return payload["message"];
      }
      if (typeof payload["data"] === "string") {
        return payload["data"];
      }
    } catch {
      return `AstrBot 服务调用失败，状态码 ${statusCode}`;
    }

    return `AstrBot 服务调用失败，状态码 ${statusCode}`;
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
