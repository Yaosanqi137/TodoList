import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  countBlockedSyncOperations,
  countPendingRemoteOperations,
  countPendingSyncOperations,
  getLocalSyncState
} from "@/services/local-sync-repo";
import type { WebSession } from "@/services/session-storage";
import { applyPendingRemoteOperations } from "@/services/sync-merge";
import { runSyncWorkerCycle } from "@/services/sync-worker";

const PERIODIC_SYNC_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_RETRY_DELAY_MS = 2_000;

export type SyncEngineStatus = {
  isOnline: boolean;
  phase: "idle" | "syncing" | "offline" | "backoff" | "attention";
  pendingCount: number;
  blockedCount: number;
  pendingRemoteCount: number;
  lastSyncedAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "同步失败，请稍后重试";
}

function calculateRetryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS);
}

export function useSyncEngine(session: WebSession | null): {
  status: SyncEngineStatus;
  triggerSync: () => void;
} {
  const userId = session?.user.id ?? "";
  const pendingCount = useLiveQuery(async () => countPendingSyncOperations(), [userId]) ?? 0;
  const blockedCount = useLiveQuery(async () => countBlockedSyncOperations(), [userId]) ?? 0;
  const pendingRemoteCount =
    useLiveQuery(async () => {
      if (!userId) {
        return 0;
      }

      return countPendingRemoteOperations(userId);
    }, [userId]) ?? 0;
  const storedSyncState =
    useLiveQuery(async () => {
      if (!userId) {
        return null;
      }

      return getLocalSyncState(userId);
    }, [userId]) ?? null;

  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const [phase, setPhase] = useState<SyncEngineStatus["phase"]>(
    window.navigator.onLine ? "idle" : "offline"
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const retryAttemptRef = useRef(0);
  const runningRef = useRef(false);
  const mergeRunningRef = useRef(false);

  useEffect(() => {
    setLastSyncedAt(storedSyncState?.lastSyncedAt ?? null);
  }, [storedSyncState]);

  const runCycle = useCallback(async () => {
    if (!userId || runningRef.current || !window.navigator.onLine) {
      return;
    }

    runningRef.current = true;
    setPhase("syncing");
    setLastError(null);
    setNextRetryAt(null);

    try {
      const result = await runSyncWorkerCycle(userId);
      retryAttemptRef.current = 0;
      setLastSyncedAt(result.lastSyncedAt);

      if (result.hasFailures) {
        const nextAttempt = retryAttemptRef.current + 1;
        retryAttemptRef.current = nextAttempt;
        const delay = calculateRetryDelay(nextAttempt);
        setLastError(result.failureMessage ?? "同步失败");
        setNextRetryAt(Date.now() + delay);
        setPhase("backoff");
        return;
      }

      setPhase(blockedCount > 0 ? "attention" : "idle");
    } catch (error) {
      const nextAttempt = retryAttemptRef.current + 1;
      retryAttemptRef.current = nextAttempt;
      const delay = calculateRetryDelay(nextAttempt);
      setLastError(getErrorMessage(error));
      setNextRetryAt(Date.now() + delay);
      setPhase("backoff");
    } finally {
      runningRef.current = false;
    }
  }, [blockedCount, userId]);

  const triggerSync = useCallback(() => {
    void runCycle();
  }, [runCycle]);

  const runMerge = useCallback(async () => {
    if (!userId || mergeRunningRef.current) {
      return;
    }

    mergeRunningRef.current = true;

    try {
      await applyPendingRemoteOperations(userId);

      if (!runningRef.current) {
        setPhase((currentPhase) => {
          if (!window.navigator.onLine) {
            return "offline";
          }

          if (currentPhase === "backoff") {
            return currentPhase;
          }

          return blockedCount > 0 ? "attention" : "idle";
        });
      }
    } catch (error) {
      setLastError(getErrorMessage(error));
      setPhase("attention");
    } finally {
      mergeRunningRef.current = false;
    }
  }, [blockedCount, userId]);

  useEffect(() => {
    function handleOnline(): void {
      setIsOnline(true);
      setPhase(blockedCount > 0 ? "attention" : "idle");
      void runCycle();
    }

    function handleOffline(): void {
      setIsOnline(false);
      setNextRetryAt(null);
      setPhase("offline");
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible" && window.navigator.onLine) {
        void runCycle();
      }
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [blockedCount, runCycle]);

  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }

    if (pendingCount === 0 && pendingRemoteCount === 0) {
      return;
    }

    void runCycle();
  }, [isOnline, pendingCount, pendingRemoteCount, runCycle, userId]);

  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void runCycle();
    }, PERIODIC_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnline, runCycle, userId]);

  useEffect(() => {
    if (!nextRetryAt || !isOnline) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        void runCycle();
      },
      Math.max(nextRetryAt - Date.now(), 0)
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOnline, nextRetryAt, runCycle]);

  useEffect(() => {
    if (!userId || pendingRemoteCount === 0 || runningRef.current) {
      return;
    }

    void runMerge();
  }, [pendingRemoteCount, runMerge, userId]);

  useEffect(() => {
    if (!userId) {
      setLastError(null);
      setLastSyncedAt(null);
      setNextRetryAt(null);
      setPhase(window.navigator.onLine ? "idle" : "offline");
      retryAttemptRef.current = 0;
    }
  }, [userId]);

  const status = useMemo<SyncEngineStatus>(() => {
    if (!isOnline) {
      return {
        isOnline,
        phase: "offline",
        pendingCount,
        blockedCount,
        pendingRemoteCount,
        lastSyncedAt,
        nextRetryAt: null,
        lastError
      };
    }

    if (blockedCount > 0 && phase !== "syncing") {
      return {
        isOnline,
        phase: "attention",
        pendingCount,
        blockedCount,
        pendingRemoteCount,
        lastSyncedAt,
        nextRetryAt,
        lastError
      };
    }

    return {
      isOnline,
      phase,
      pendingCount,
      blockedCount,
      pendingRemoteCount,
      lastSyncedAt,
      nextRetryAt,
      lastError
    };
  }, [
    blockedCount,
    isOnline,
    lastError,
    lastSyncedAt,
    nextRetryAt,
    pendingCount,
    pendingRemoteCount,
    phase
  ]);

  return {
    status,
    triggerSync
  };
}
