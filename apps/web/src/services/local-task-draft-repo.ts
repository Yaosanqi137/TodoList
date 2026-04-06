import { localDb, type LocalTaskDraftRecord } from "@/services/local-db";
import {
  decryptTaskDraftRecord,
  encryptTaskDraftRecord,
  shouldEncryptTaskDraft
} from "@/services/local-sensitive-codec";

export type SaveLocalTaskDraftInput = {
  taskId: string;
  userId: string;
  title: string;
  contentJson: string | null;
  contentText: string;
  priority: LocalTaskDraftRecord["priority"];
  status: LocalTaskDraftRecord["status"];
  ddlInput: string;
};

export async function getLocalTaskDraft(taskId: string): Promise<LocalTaskDraftRecord | undefined> {
  const draft = await localDb.taskDrafts.get(taskId);
  if (!draft) {
    return undefined;
  }

  if (shouldEncryptTaskDraft(draft)) {
    await localDb.taskDrafts.put(await encryptTaskDraftRecord(draft));
  }

  return decryptTaskDraftRecord(draft);
}

export async function saveLocalTaskDraft(
  input: SaveLocalTaskDraftInput
): Promise<LocalTaskDraftRecord> {
  const draft: LocalTaskDraftRecord = {
    ...input,
    updatedAt: Date.now()
  };

  await localDb.taskDrafts.put(await encryptTaskDraftRecord(draft));
  return draft;
}

export async function deleteLocalTaskDraft(taskId: string): Promise<void> {
  await localDb.taskDrafts.delete(taskId);
}
