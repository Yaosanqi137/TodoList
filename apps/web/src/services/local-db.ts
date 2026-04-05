import Dexie, { type Table } from "dexie";

export type LocalTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type LocalTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "ARCHIVED";

export type SyncEntityType = "TASK";

export type SyncActionType = "CREATE" | "UPDATE" | "DELETE";

export type LocalTaskRecord = {
  id: string;
  userId: string;
  title: string;
  contentJson: string | null;
  contentText: string | null;
  priority: LocalTaskPriority;
  status: LocalTaskStatus;
  ddlAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type LocalOpLogRecord = {
  opId: string;
  entityId: string;
  entityType: SyncEntityType;
  action: SyncActionType;
  payload: string;
  clientTs: number;
  deviceId: string;
  syncedAt: number | null;
  retryCount: number;
  errorMessage: string | null;
};

export type LocalTaskDraftRecord = {
  taskId: string;
  userId: string;
  title: string;
  contentJson: string | null;
  contentText: string;
  priority: LocalTaskPriority;
  status: LocalTaskStatus;
  ddlInput: string;
  updatedAt: number;
};

export type LocalSyncStateRecord = {
  userId: string;
  cursor: string | null;
  lastSyncedAt: number | null;
  updatedAt: number;
};

export type LocalSyncInboxRecord = {
  opId: string;
  userId: string;
  entityId: string;
  entityType: SyncEntityType;
  action: SyncActionType;
  payload: string | null;
  clientTs: number;
  deviceId: string;
  serverTs: number;
  receivedAt: number;
  appliedAt: number | null;
};

class TodoLocalDb extends Dexie {
  declare tasks: Table<LocalTaskRecord, string>;
  declare opLogs: Table<LocalOpLogRecord, string>;
  declare taskDrafts: Table<LocalTaskDraftRecord, string>;
  declare syncStates: Table<LocalSyncStateRecord, string>;
  declare syncInbox: Table<LocalSyncInboxRecord, string>;

  constructor() {
    super("todolist-web-db");

    this.version(1).stores({
      tasks: "&id,userId,status,priority,ddlAt,updatedAt,deletedAt",
      op_logs: "&opId,entityId,entityType,action,clientTs,syncedAt"
    });

    this.version(2).stores({
      tasks: "&id,userId,status,priority,ddlAt,updatedAt,deletedAt",
      op_logs: "&opId,entityId,entityType,action,clientTs,syncedAt",
      task_drafts: "&taskId,userId,updatedAt"
    });

    this.version(3).stores({
      tasks: "&id,userId,status,priority,ddlAt,updatedAt,deletedAt",
      op_logs: "&opId,entityId,entityType,action,clientTs,syncedAt",
      task_drafts: "&taskId,userId,updatedAt",
      sync_states: "&userId,updatedAt,lastSyncedAt",
      sync_inbox: "&opId,userId,entityId,serverTs,appliedAt"
    });

    this.version(4)
      .stores({
        tasks: "&id,userId,status,priority,ddlAt,updatedAt,deletedAt",
        op_logs: "&opId,entityId,entityType,action,clientTs,syncedAt",
        task_drafts: "&taskId,userId,updatedAt",
        sync_states: "&userId,updatedAt,lastSyncedAt",
        sync_inbox: "&opId,userId,entityId,serverTs,appliedAt"
      })
      .upgrade(async (tx) => {
        await tx
          .table("tasks")
          .toCollection()
          .modify((task: Partial<LocalTaskRecord>) => {
            if (typeof task.version !== "number") {
              task.version = 1;
            }
          });
      });

    this.tasks = this.table("tasks");
    this.opLogs = this.table("op_logs");
    this.taskDrafts = this.table("task_drafts");
    this.syncStates = this.table("sync_states");
    this.syncInbox = this.table("sync_inbox");
  }
}

export const localDb = new TodoLocalDb();
