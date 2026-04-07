import {
  localDb,
  type LocalOpLogRecord,
  type LocalTaskPriority,
  type LocalTaskRecord,
  type LocalTaskStatus,
  type SyncActionType
} from "@/services/local-db";
import {
  decryptTaskRecord,
  encryptOpLogRecord,
  encryptTaskRecord
} from "@/services/local-sensitive-codec";

const DEVICE_ID_STORAGE_KEY = "todolist.web.device-id";

export type CreateLocalTaskInput = {
  userId: string;
  title?: string;
};

export type UpdateLocalTaskInput = {
  id: string;
  title?: string;
  contentText?: string | null;
  contentJson?: string | null;
  priority?: LocalTaskPriority;
  status?: LocalTaskStatus;
  ddlAt?: number | null;
};

type SyncTaskPayload = {
  id?: string;
  userId?: string;
  title: string;
  contentJson: string | null;
  contentText?: string | null;
  priority: LocalTaskPriority;
  status: LocalTaskStatus;
  ddlAt: number | null;
  version: number;
  createdAt?: number;
  updatedAt: number;
  deletedAt?: number | null;
};

function resolveDeviceId(): string {
  const savedDeviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (savedDeviceId) {
    return savedDeviceId;
  }

  const nextDeviceId = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

function createOpLogRecord(
  entityId: string,
  action: SyncActionType,
  payload: string
): LocalOpLogRecord {
  return {
    opId: crypto.randomUUID(),
    entityId,
    entityType: "TASK",
    action,
    payload,
    clientTs: Date.now(),
    deviceId: resolveDeviceId(),
    syncedAt: null,
    retryCount: 0,
    errorMessage: null
  };
}

function createSyncTaskPayload(payload: SyncTaskPayload): string {
  const nextPayload: Record<string, unknown> = {
    ...payload
  };

  if (payload.contentJson !== null) {
    delete nextPayload.contentText;
  }

  return JSON.stringify(nextPayload);
}

export async function listLocalTasksByUser(userId: string): Promise<LocalTaskRecord[]> {
  const tasks = await localDb.tasks.where("userId").equals(userId).toArray();
  const decryptedTasks = await Promise.all(tasks.map((task) => decryptTaskRecord(task)));
  return decryptedTasks
    .filter((task) => task.deletedAt === null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getLocalTaskById(id: string): Promise<LocalTaskRecord | undefined> {
  const task = await localDb.tasks.get(id);
  if (!task || task.deletedAt !== null) {
    return undefined;
  }

  return decryptTaskRecord(task);
}

export async function createLocalTask(input: CreateLocalTaskInput): Promise<LocalTaskRecord> {
  const now = Date.now();
  const task: LocalTaskRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    title: input.title?.trim() ? input.title.trim() : "未命名任务",
    contentJson: null,
    contentText: null,
    priority: "MEDIUM",
    status: "TODO",
    ddlAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };

  const opLog = createOpLogRecord(
    task.id,
    "CREATE",
    createSyncTaskPayload({
      id: task.id,
      userId: task.userId,
      title: task.title,
      contentJson: task.contentJson,
      contentText: task.contentText,
      priority: task.priority,
      status: task.status,
      ddlAt: task.ddlAt,
      version: task.version,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      deletedAt: task.deletedAt
    })
  );

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.add(await encryptTaskRecord(task));
    await localDb.opLogs.add(await encryptOpLogRecord(opLog));
  });

  return task;
}

export async function updateLocalTask(
  input: UpdateLocalTaskInput
): Promise<LocalTaskRecord | undefined> {
  const currentTask = await getLocalTaskById(input.id);
  if (!currentTask) {
    return undefined;
  }

  const nextVersion = currentTask.version + 1;
  const nextTask: LocalTaskRecord = {
    ...currentTask,
    title: input.title !== undefined ? input.title.trim() || "未命名任务" : currentTask.title,
    contentText: input.contentText !== undefined ? input.contentText : currentTask.contentText,
    contentJson: input.contentJson !== undefined ? input.contentJson : currentTask.contentJson,
    priority: input.priority ?? currentTask.priority,
    status: input.status ?? currentTask.status,
    ddlAt: input.ddlAt !== undefined ? input.ddlAt : currentTask.ddlAt,
    version: nextVersion,
    updatedAt: Date.now()
  };

  const opLog = createOpLogRecord(
    nextTask.id,
    "UPDATE",
    createSyncTaskPayload({
      title: nextTask.title,
      contentJson: nextTask.contentJson,
      contentText: nextTask.contentText,
      priority: nextTask.priority,
      status: nextTask.status,
      ddlAt: nextTask.ddlAt,
      version: nextTask.version,
      updatedAt: nextTask.updatedAt
    })
  );

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.put(await encryptTaskRecord(nextTask));
    await localDb.opLogs.add(await encryptOpLogRecord(opLog));
  });

  return nextTask;
}

export async function deleteLocalTask(id: string): Promise<boolean> {
  const currentTask = await getLocalTaskById(id);
  if (!currentTask) {
    return false;
  }

  const deletedAt = Date.now();
  const nextVersion = currentTask.version + 1;
  const nextTask: LocalTaskRecord = {
    ...currentTask,
    version: nextVersion,
    deletedAt,
    updatedAt: deletedAt
  };

  const opLog = createOpLogRecord(
    id,
    "DELETE",
    JSON.stringify({
      deletedAt,
      version: nextTask.version,
      updatedAt: nextTask.updatedAt
    })
  );

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.put(await encryptTaskRecord(nextTask));
    await localDb.opLogs.add(await encryptOpLogRecord(opLog));
  });

  return true;
}
