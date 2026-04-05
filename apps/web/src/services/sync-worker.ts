import {
  enqueueRemoteSyncOperations,
  getLocalSyncState,
  listPendingSyncOperations,
  markSyncOperationsFailed,
  markSyncOperationsSucceeded,
  saveLocalSyncState
} from "@/services/local-sync-repo";
import { applyPendingRemoteOperations } from "@/services/sync-merge";
import {
  pullSyncOperations,
  pushSyncOperations,
  serializeSyncOperationForRequest
} from "@/services/sync-api";
import type { LocalOpLogRecord } from "@/services/local-db";

const PUSH_BATCH_LIMIT = 20;
const PUSH_BATCH_MAX_BYTES = 256 * 1024;
const PULL_BATCH_LIMIT = 100;
const MAX_PULL_PAGES_PER_CYCLE = 5;

function estimateOperationBytes(operation: LocalOpLogRecord): number {
  return new TextEncoder().encode(JSON.stringify(serializeSyncOperationForRequest(operation)))
    .length;
}

function createPushBatch(operations: LocalOpLogRecord[]): LocalOpLogRecord[] {
  const batch: LocalOpLogRecord[] = [];
  let batchBytes = 0;

  for (const operation of operations) {
    const operationBytes = estimateOperationBytes(operation);
    if (batch.length > 0 && batchBytes + operationBytes > PUSH_BATCH_MAX_BYTES) {
      break;
    }

    batch.push(operation);
    batchBytes += operationBytes;
  }

  return batch;
}

export type SyncCycleResult = {
  pushedCount: number;
  pulledCount: number;
  appliedRemoteCount: number;
  lastSyncedAt: number;
  hasFailures: boolean;
  failureMessage: string | null;
};

export async function runSyncWorkerCycle(userId: string): Promise<SyncCycleResult> {
  const lastSyncedAt = Date.now();
  let pushedCount = 0;
  let pulledCount = 0;
  let appliedRemoteCount = 0;
  let hasFailures = false;
  let failureMessage: string | null = null;

  for (;;) {
    const pendingCandidates = await listPendingSyncOperations(PUSH_BATCH_LIMIT);
    if (pendingCandidates.length === 0) {
      break;
    }

    const pendingOperations = createPushBatch(pendingCandidates);
    const pushResult = await pushSyncOperations(userId, pendingOperations);
    const syncedOperationIds = pushResult.results
      .filter((result) => result.status === "accepted" || result.status === "duplicate")
      .map((result) => result.opId);
    const failedOperations = pushResult.results
      .filter((result) => result.status === "failed")
      .map((result) => ({
        opId: result.opId,
        errorMessage: result.reason ?? "同步失败"
      }));

    await markSyncOperationsSucceeded(syncedOperationIds, lastSyncedAt);
    await markSyncOperationsFailed(failedOperations);

    pushedCount += syncedOperationIds.length;

    if (failedOperations.length > 0) {
      hasFailures = true;
      failureMessage = failedOperations[0]?.errorMessage ?? "同步失败";
      break;
    }

    if (
      pendingCandidates.length < PUSH_BATCH_LIMIT ||
      pendingOperations.length < pendingCandidates.length
    ) {
      break;
    }
  }

  const currentState = await getLocalSyncState(userId);
  let nextCursor = currentState?.cursor ?? null;

  for (let page = 0; page < MAX_PULL_PAGES_PER_CYCLE; page += 1) {
    const pullResult = await pullSyncOperations({
      userId,
      cursor: nextCursor,
      limit: PULL_BATCH_LIMIT
    });

    if (pullResult.items.length > 0) {
      pulledCount += await enqueueRemoteSyncOperations(userId, pullResult.items);
    }

    nextCursor = pullResult.nextCursor;
    await saveLocalSyncState({
      userId,
      cursor: nextCursor,
      lastSyncedAt
    });

    if (!pullResult.hasMore) {
      break;
    }
  }

  if (currentState === undefined && nextCursor === null) {
    await saveLocalSyncState({
      userId,
      cursor: null,
      lastSyncedAt
    });
  }

  appliedRemoteCount = await applyPendingRemoteOperations(userId);

  return {
    pushedCount,
    pulledCount,
    appliedRemoteCount,
    lastSyncedAt,
    hasFailures,
    failureMessage
  };
}
