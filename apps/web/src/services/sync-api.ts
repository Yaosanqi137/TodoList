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

export async function pushSyncOperations(
  userId: string,
  operations: LocalOpLogRecord[]
): Promise<SyncPushResult> {
  const response = await fetch(`${resolveApiBaseUrl()}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId
    },
    body: JSON.stringify({
      operations: operations.map((operation) => ({
        opId: operation.opId,
        entityId: operation.entityId,
        entityType: operation.entityType,
        action: operation.action,
        payload: operation.payload,
        clientTs: operation.clientTs,
        deviceId: operation.deviceId
      }))
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
