import {
  localDb,
  type LocalOpLogRecord,
  type LocalTaskPriority,
  type LocalTaskRecord,
  type LocalTaskStatus,
  type SyncActionType
} from "@/services/local-db";

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

export async function listLocalTasksByUser(userId: string): Promise<LocalTaskRecord[]> {
  const tasks = await localDb.tasks.where("userId").equals(userId).toArray();
  return tasks
    .filter((task) => task.deletedAt === null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getLocalTaskById(id: string): Promise<LocalTaskRecord | undefined> {
  const task = await localDb.tasks.get(id);
  if (!task || task.deletedAt !== null) {
    return undefined;
  }

  return task;
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
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };

  const opLog = createOpLogRecord(task.id, "CREATE", JSON.stringify(task));

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.add(task);
    await localDb.opLogs.add(opLog);
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

  const nextTask: LocalTaskRecord = {
    ...currentTask,
    title: input.title !== undefined ? input.title.trim() || "未命名任务" : currentTask.title,
    contentText: input.contentText !== undefined ? input.contentText : currentTask.contentText,
    contentJson: input.contentJson !== undefined ? input.contentJson : currentTask.contentJson,
    priority: input.priority ?? currentTask.priority,
    status: input.status ?? currentTask.status,
    ddlAt: input.ddlAt !== undefined ? input.ddlAt : currentTask.ddlAt,
    updatedAt: Date.now()
  };

  const opLog = createOpLogRecord(
    nextTask.id,
    "UPDATE",
    JSON.stringify({
      title: nextTask.title,
      contentText: nextTask.contentText,
      contentJson: nextTask.contentJson,
      priority: nextTask.priority,
      status: nextTask.status,
      ddlAt: nextTask.ddlAt,
      updatedAt: nextTask.updatedAt
    })
  );

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.put(nextTask);
    await localDb.opLogs.add(opLog);
  });

  return nextTask;
}

export async function deleteLocalTask(id: string): Promise<boolean> {
  const currentTask = await getLocalTaskById(id);
  if (!currentTask) {
    return false;
  }

  const deletedAt = Date.now();
  const nextTask: LocalTaskRecord = {
    ...currentTask,
    deletedAt,
    updatedAt: deletedAt
  };

  const opLog = createOpLogRecord(id, "DELETE", JSON.stringify({ deletedAt }));

  await localDb.transaction("rw", localDb.tasks, localDb.opLogs, async () => {
    await localDb.tasks.put(nextTask);
    await localDb.opLogs.add(opLog);
  });

  return true;
}
