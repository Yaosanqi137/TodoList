import type { WebSession } from "@/services/session-storage";

export type WebAiChannel = "USER_KEY" | "ASTRBOT" | "PUBLIC_POOL";

export type WebAiRouteAttempt = {
  channel: WebAiChannel;
  providerName: string | null;
  model: string | null;
  status: "skipped" | "failed" | "success";
  reasonCode: string | null;
  reasonMessage: string | null;
};

export type WebAiBindingSummary = {
  id: string;
  channel: WebAiChannel;
  providerName: string;
  model: string | null;
  configId: string | null;
  configName: string | null;
  endpoint: string | null;
  isEnabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  updatedAt: string;
};

export type WebAiBindingsResponse = {
  routeOrder: WebAiChannel[];
  bindings: WebAiBindingSummary[];
  publicPool: {
    enabled: boolean;
    providerName: string | null;
    model: string | null;
    hasApiKey: boolean;
  } | null;
};

export type UpsertWebAiBindingInput = {
  channel: Exclude<WebAiChannel, "PUBLIC_POOL">;
  providerName?: string;
  model?: string;
  configId?: string;
  configName?: string;
  endpoint?: string;
  apiKey?: string;
  isEnabled?: boolean;
};

export type WebAiChatResponse = {
  channel: WebAiChannel;
  providerName: string;
  model: string | null;
  content: string;
  sessionId: string | null;
  attempts: WebAiRouteAttempt[];
};

export type WebAiLocalTaskContextItem = {
  id: string;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "TODO" | "IN_PROGRESS" | "DONE" | "ARCHIVED";
  ddlAt: number | null;
  contentText: string | null;
  updatedAt: number;
};

export class WebAiApiError extends Error {
  attempts: WebAiRouteAttempt[] | null;

  constructor(message: string, attempts?: WebAiRouteAttempt[] | null) {
    super(message);
    this.name = "WebAiApiError";
    this.attempts = attempts ?? null;
  }
}

const DEFAULT_API_BASE_URL = "http://localhost:3000";

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!envBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  return envBaseUrl.replace(/\/+$/, "");
}

function createHeaders(session: WebSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
    "x-user-id": session.user.id
  };
}

async function createApiError(response: Response): Promise<WebAiApiError> {
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      attempts?: WebAiRouteAttempt[];
    };
    const message = Array.isArray(body.message)
      ? body.message.join("；")
      : typeof body.message === "string" && body.message.trim().length > 0
        ? body.message
        : `请求失败（${response.status}）`;
    return new WebAiApiError(message, body.attempts ?? null);
  } catch {
    return new WebAiApiError(`请求失败（${response.status}）`);
  }
}
export async function listAiBindings(session: WebSession): Promise<WebAiBindingsResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/ai/bindings`, {
    method: "GET",
    headers: createHeaders(session)
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  return (await response.json()) as WebAiBindingsResponse;
}

export async function upsertAiBinding(
  session: WebSession,
  payload: UpsertWebAiBindingInput
): Promise<WebAiBindingSummary> {
  const response = await fetch(`${resolveApiBaseUrl()}/ai/bindings`, {
    method: "POST",
    headers: createHeaders(session),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  return (await response.json()) as WebAiBindingSummary;
}

export async function chatWithAi(
  session: WebSession,
  payload: {
    channel: WebAiChannel;
    message: string;
    sessionId?: string;
    localTasks?: WebAiLocalTaskContextItem[];
  }
): Promise<WebAiChatResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/ai/chat`, {
    method: "POST",
    headers: createHeaders(session),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await createApiError(response);
  }

  return (await response.json()) as WebAiChatResponse;
}
