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

class TodoLocalDb extends Dexie {
  declare tasks: Table<LocalTaskRecord, string>;
  declare opLogs: Table<LocalOpLogRecord, string>;

  constructor() {
    super("todolist-web-db");

    this.version(1).stores({
      tasks: "&id,userId,status,priority,ddlAt,updatedAt,deletedAt",
      op_logs: "&opId,entityId,entityType,action,clientTs,syncedAt"
    });

    this.tasks = this.table("tasks");
    this.opLogs = this.table("op_logs");
  }
}

export const localDb = new TodoLocalDb();
