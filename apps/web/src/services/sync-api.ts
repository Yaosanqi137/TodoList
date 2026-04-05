import type { LocalOpLogRecord } from "@/services/local-db";

export type SyncPushResult = {
  acceptedCount: number;
  duplicateCount: number;
  failedCount: number;
  results: Array<{
    opId: string;
    status: "accepted" | "duplicate" | "failed";
    serverTs: string | null;
    reason: string | null;
  }>;
};

export type SyncPullItem = {
  opId: string;
  entityId: string;
  entityType: "TASK";
  action: "CREATE" | "UPDATE" | "DELETE";
  payload: string | null;
  clientTs: number;
  deviceId: string;
  serverTs: string;
};

export type SyncPullResult = {
  items: SyncPullItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

const DEFAULT_API_BASE_URL = "http://localhost:3000";

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!envBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  return envBaseUrl.replace(/\/+$/, "");
}

async function parseErrorMessage(response: Response): Promise<string> {
  if (response.status === 413) {
    return "单次同步内容过大，请精简本次任务内容或等待系统分批重试。";
  }

  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join("，");
    }

    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    return `请求失败（${response.status}）`;
  }

  return `请求失败（${response.status}）`;
}

type SyncPushOperationRequest = {
  opId: string;
  entityId: string;
  entityType: LocalOpLogRecord["entityType"];
  action: LocalOpLogRecord["action"];
  payload: string;
  clientTs: number;
  deviceId: string;
};

function compactOperationPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return payload;
    }

    const nextPayload = { ...(parsed as Record<string, unknown>) };
    if (nextPayload.contentJson !== undefined && nextPayload.contentJson !== null) {
      delete nextPayload.contentText;
    }

    return JSON.stringify(nextPayload);
  } catch {
    return payload;
  }
}

export function serializeSyncOperationForRequest(
  operation: LocalOpLogRecord
): SyncPushOperationRequest {
  return {
    opId: operation.opId,
    entityId: operation.entityId,
    entityType: operation.entityType,
    action: operation.action,
    payload: compactOperationPayload(operation.payload),
    clientTs: operation.clientTs,
    deviceId: operation.deviceId
  };
}

export async function pushSyncOperations(
  userId: string,
  operations: LocalOpLogRecord[]
): Promise<SyncPushResult> {
  const requestOperations = operations.map((operation) =>
    serializeSyncOperationForRequest(operation)
  );

  const response = await fetch(`${resolveApiBaseUrl()}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId
    },
    body: JSON.stringify({
      operations: requestOperations
    })
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SyncPushResult;
}

export async function pullSyncOperations(input: {
  userId: string;
  cursor: string | null;
  limit?: number;
}): Promise<SyncPullResult> {
  const requestUrl = new URL(`${resolveApiBaseUrl()}/sync/pull`);

  if (input.cursor) {
    requestUrl.searchParams.set("cursor", input.cursor);
  }

  if (input.limit !== undefined) {
    requestUrl.searchParams.set("limit", String(input.limit));
  }

  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {
      "x-user-id": input.userId
    }
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SyncPullResult;
}
