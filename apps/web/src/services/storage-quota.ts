import { listLocalTasksByUser } from "@/services/local-task-repo";

export const DEFAULT_CLOUD_QUOTA_BYTES = 100 * 1024 * 1024;

type StorageQuotaSnapshot = {
  usedBytes: number;
  quotaBytes: number;
  remainingBytes: number;
  usedPercent: number;
};

function measureTextBytes(value: string | null): number {
  if (!value) {
    return 0;
  }

  return new Blob([value]).size;
}

export async function getStorageQuotaSnapshot(userId: string): Promise<StorageQuotaSnapshot> {
  const tasks = await listLocalTasksByUser(userId);

  const usedBytes = tasks.reduce((total, task) => {
    return (
      total +
      measureTextBytes(task.title) +
      measureTextBytes(task.contentText) +
      measureTextBytes(task.contentJson)
    );
  }, 0);

  const remainingBytes = Math.max(DEFAULT_CLOUD_QUOTA_BYTES - usedBytes, 0);
  const usedPercent = Math.min((usedBytes / DEFAULT_CLOUD_QUOTA_BYTES) * 100, 100);

  return {
    usedBytes,
    quotaBytes: DEFAULT_CLOUD_QUOTA_BYTES,
    remainingBytes,
    usedPercent
  };
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
