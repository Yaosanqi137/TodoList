import {
  localDb,
  type LocalSyncInboxRecord,
  type LocalTaskPriority,
  type LocalTaskRecord,
  type LocalTaskStatus
} from "@/services/local-db";
import { listPendingRemoteOperations } from "@/services/local-sync-repo";

const TASK_PRIORITY_VALUES: LocalTaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TASK_STATUS_VALUES: LocalTaskStatus[] = ["TODO", "IN_PROGRESS", "DONE", "ARCHIVED"];

type RemoteTaskPayload = {
  userId?: unknown;
  title?: unknown;
  contentJson?: unknown;
  contentText?: unknown;
  priority?: unknown;
  status?: unknown;
  ddlAt?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
};

function normalizePriority(value: unknown, fallback: LocalTaskPriority): LocalTaskPriority {
  if (typeof value === "string" && TASK_PRIORITY_VALUES.includes(value as LocalTaskPriority)) {
    return value as LocalTaskPriority;
  }

  return fallback;
}

function normalizeStatus(value: unknown, fallback: LocalTaskStatus): LocalTaskStatus {
  if (typeof value === "string" && TASK_STATUS_VALUES.includes(value as LocalTaskStatus)) {
    return value as LocalTaskStatus;
  }

  return fallback;
}

function normalizeStringOrNull(value: unknown, fallback: string | null): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value === null) {
    return null;
  }

  return fallback;
}

function collectTextFromRichContent(value: unknown, fragments: string[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const node = value as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof node.text === "string" && node.text.trim().length > 0) {
    fragments.push(node.text.trim());
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectTextFromRichContent(child, fragments);
    }
  }
}

function extractTextFromContentJson(contentJson: string | null): string | null {
  if (!contentJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(contentJson) as unknown;
    const fragments: string[] = [];
    collectTextFromRichContent(parsed, fragments);
    return fragments.length > 0 ? fragments.join(" ") : null;
  } catch {
    return null;
  }
}

function normalizeNullableNumber(value: unknown, fallback: number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null) {
    return null;
  }

  return fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
}

function parseOperationPayload(operation: LocalSyncInboxRecord): RemoteTaskPayload {
  if (!operation.payload) {
    return {};
  }

  const parsed = JSON.parse(operation.payload) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return parsed as RemoteTaskPayload;
}

function createFallbackTask(
  operation: LocalSyncInboxRecord,
  userId: string,
  updatedAt: number,
  version: number
): LocalTaskRecord {
  return {
    id: operation.entityId,
    userId,
    title: "未命名任务",
    contentJson: null,
    contentText: null,
    priority: "MEDIUM",
    status: "TODO",
    ddlAt: null,
    version,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null
  };
}

function buildIncomingTaskRecord(
  operation: LocalSyncInboxRecord,
  currentTask: LocalTaskRecord | undefined
): LocalTaskRecord {
  const payload = parseOperationPayload(operation);
  const fallbackVersion = currentTask?.version ?? 1;
  const version = normalizePositiveNumber(payload.version, fallbackVersion);
  const updatedAt = normalizePositiveNumber(
    payload.updatedAt,
    normalizePositiveNumber(payload.deletedAt, operation.clientTs)
  );
  const fallbackTask =
    currentTask ?? createFallbackTask(operation, operation.userId, updatedAt, version);
  const contentJson = normalizeStringOrNull(payload.contentJson, fallbackTask.contentJson);
  const contentText = normalizeStringOrNull(
    payload.contentText,
    extractTextFromContentJson(contentJson) ?? fallbackTask.contentText
  );

  if (operation.action === "DELETE") {
    const deletedAt = normalizePositiveNumber(payload.deletedAt, updatedAt);
    return {
      ...fallbackTask,
      version,
      updatedAt: deletedAt,
      deletedAt
    };
  }

  return {
    ...fallbackTask,
    userId: typeof payload.userId === "string" ? payload.userId : fallbackTask.userId,
    title:
      typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title
        : fallbackTask.title,
    contentJson,
    contentText,
    priority: normalizePriority(payload.priority, fallbackTask.priority),
    status: normalizeStatus(payload.status, fallbackTask.status),
    ddlAt: normalizeNullableNumber(payload.ddlAt, fallbackTask.ddlAt),
    version,
    createdAt: normalizePositiveNumber(payload.createdAt, fallbackTask.createdAt),
    updatedAt,
    deletedAt: normalizeNullableNumber(payload.deletedAt, null)
  };
}

function getOperationTieBreaker(operation: LocalSyncInboxRecord): number {
  if (operation.action === "DELETE") {
    return 3;
  }

  if (operation.action === "UPDATE") {
    return 2;
  }

  return 1;
}

function shouldApplyIncomingTask(
  currentTask: LocalTaskRecord | undefined,
  incomingTask: LocalTaskRecord,
  operation: LocalSyncInboxRecord
): boolean {
  if (!currentTask) {
    return true;
  }

  if (incomingTask.updatedAt > currentTask.updatedAt) {
    return true;
  }

  if (incomingTask.updatedAt < currentTask.updatedAt) {
    return false;
  }

  if (incomingTask.version > currentTask.version) {
    return true;
  }

  if (incomingTask.version < currentTask.version) {
    return false;
  }

  return getOperationTieBreaker(operation) >= (currentTask.deletedAt === null ? 1 : 3);
}

export async function applyPendingRemoteOperations(userId: string): Promise<number> {
  const pendingOperations = await listPendingRemoteOperations(userId);
  if (pendingOperations.length === 0) {
    return 0;
  }

  const appliedAt = Date.now();

  await localDb.transaction("rw", localDb.tasks, localDb.syncInbox, async () => {
    for (const operation of pendingOperations) {
      if (operation.entityType !== "TASK") {
        await localDb.syncInbox.update(operation.opId, { appliedAt });
        continue;
      }

      const currentTask = await localDb.tasks.get(operation.entityId);
      const incomingTask = buildIncomingTaskRecord(operation, currentTask);

      if (shouldApplyIncomingTask(currentTask, incomingTask, operation)) {
        await localDb.tasks.put(incomingTask);
      }

      await localDb.syncInbox.update(operation.opId, { appliedAt });
    }
  });

  return pendingOperations.length;
}
