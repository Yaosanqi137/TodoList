import { AiChannel } from "../../generated/prisma/client";

export type AiResolvedRouteCandidate = {
  channel: AiChannel;
  source: "binding" | "public_pool";
  sourceId: string | null;
  providerName: string;
  model: string | null;
  configId: string | null;
  configName: string | null;
  endpoint: string | null;
  apiKey: string | null;
};

export type AiChatInput = {
  userId: string;
  message: string;
  sessionId: string | null;
};

export type AiChatResult = {
  channel: AiChannel;
  providerName: string;
  model: string | null;
  content: string;
  sessionId: string | null;
  raw: unknown;
};

export type AiRouteAttempt = {
  channel: AiChannel;
  providerName: string | null;
  model: string | null;
  status: "skipped" | "failed" | "success";
  reasonCode: string | null;
  reasonMessage: string | null;
};

export class AiRouteFailureError extends Error {
  constructor(
    public readonly channel: AiChannel,
    public readonly providerName: string,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiRouteFailureError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AiChannelExecutor {
  execute(candidate: AiResolvedRouteCandidate, input: AiChatInput): Promise<AiChatResult>;
}
