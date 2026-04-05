import {
  localDb,
  type LocalOpLogRecord,
  type LocalSyncInboxRecord,
  type LocalSyncStateRecord
} from "@/services/local-db";
import type { SyncPullItem } from "@/services/sync-api";

export const MAX_SYNC_RETRY_COUNT = 5;

export async function listPendingSyncOperations(limit = 20): Promise<LocalOpLogRecord[]> {
  const records = await localDb.opLogs.orderBy("clientTs").toArray();

  return records
    .filter((record) => record.syncedAt === null && record.retryCount < MAX_SYNC_RETRY_COUNT)
    .slice(0, limit);
}

export async function countPendingSyncOperations(): Promise<number> {
  const records = await localDb.opLogs.toArray();
  return records.filter(
    (record) => record.syncedAt === null && record.retryCount < MAX_SYNC_RETRY_COUNT
  ).length;
}

export async function countBlockedSyncOperations(): Promise<number> {
  const records = await localDb.opLogs.toArray();
  return records.filter(
    (record) => record.syncedAt === null && record.retryCount >= MAX_SYNC_RETRY_COUNT
  ).length;
}

export async function markSyncOperationsSucceeded(
  opIds: string[],
  syncedAt: number
): Promise<void> {
  if (opIds.length === 0) {
    return;
  }

  const records = await localDb.opLogs.bulkGet(opIds);
  const nextRecords = records
    .filter((record): record is LocalOpLogRecord => record !== undefined)
    .map((record) => ({
      ...record,
      syncedAt,
      errorMessage: null
    }));

  if (nextRecords.length > 0) {
    await localDb.opLogs.bulkPut(nextRecords);
  }
}

export async function markSyncOperationsFailed(
  failures: Array<{ opId: string; errorMessage: string }>
): Promise<void> {
  if (failures.length === 0) {
    return;
  }

  const failureMap = new Map(failures.map((failure) => [failure.opId, failure.errorMessage]));
  const records = await localDb.opLogs.bulkGet(failures.map((failure) => failure.opId));
  const nextRecords = records
    .filter((record): record is LocalOpLogRecord => record !== undefined)
    .map((record) => ({
      ...record,
      retryCount: record.retryCount + 1,
      errorMessage: failureMap.get(record.opId) ?? "同步失败"
    }));

  if (nextRecords.length > 0) {
    await localDb.opLogs.bulkPut(nextRecords);
  }
}

export async function getLocalSyncState(userId: string): Promise<LocalSyncStateRecord | undefined> {
  return localDb.syncStates.get(userId);
}

export async function saveLocalSyncState(input: {
  userId: string;
  cursor: string | null;
  lastSyncedAt: number | null;
}): Promise<void> {
  await localDb.syncStates.put({
    userId: input.userId,
    cursor: input.cursor,
    lastSyncedAt: input.lastSyncedAt,
    updatedAt: Date.now()
  });
}

export async function enqueueRemoteSyncOperations(
  userId: string,
  operations: SyncPullItem[]
): Promise<number> {
  if (operations.length === 0) {
    return 0;
  }

  const receivedAt = Date.now();
  const records: LocalSyncInboxRecord[] = operations.map((operation) => ({
    opId: operation.opId,
    userId,
    entityId: operation.entityId,
    entityType: operation.entityType,
    action: operation.action,
    payload: operation.payload,
    clientTs: operation.clientTs,
    deviceId: operation.deviceId,
    serverTs: new Date(operation.serverTs).getTime(),
    receivedAt,
    appliedAt: null
  }));

  await localDb.syncInbox.bulkPut(records);
  return records.length;
}

export async function listPendingRemoteOperations(
  userId: string,
  limit = 100
): Promise<LocalSyncInboxRecord[]> {
  const records = await localDb.syncInbox.where("userId").equals(userId).toArray();

  return records
    .filter((record) => record.appliedAt === null)
    .sort((left, right) => {
      if (left.serverTs !== right.serverTs) {
        return left.serverTs - right.serverTs;
      }

      if (left.clientTs !== right.clientTs) {
        return left.clientTs - right.clientTs;
      }

      return left.opId.localeCompare(right.opId);
    })
    .slice(0, limit);
}

export async function markRemoteOperationsApplied(
  opIds: string[],
  appliedAt: number
): Promise<void> {
  if (opIds.length === 0) {
    return;
  }

  const records = await localDb.syncInbox.bulkGet(opIds);
  const nextRecords = records
    .filter((record): record is LocalSyncInboxRecord => record !== undefined)
    .map((record) => ({
      ...record,
      appliedAt
    }));

  if (nextRecords.length > 0) {
    await localDb.syncInbox.bulkPut(nextRecords);
  }
}

export async function countPendingRemoteOperations(userId: string): Promise<number> {
  const records = await localDb.syncInbox.where("userId").equals(userId).toArray();
  return records.filter((record) => record.appliedAt === null).length;
}
