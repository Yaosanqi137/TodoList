import { localDb, type LocalTaskDraftRecord } from "@/services/local-db";

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
  return localDb.taskDrafts.get(taskId);
}

export async function saveLocalTaskDraft(
  input: SaveLocalTaskDraftInput
): Promise<LocalTaskDraftRecord> {
  const draft: LocalTaskDraftRecord = {
    ...input,
    updatedAt: Date.now()
  };

  await localDb.taskDrafts.put(draft);
  return draft;
}

export async function deleteLocalTaskDraft(taskId: string): Promise<void> {
  await localDb.taskDrafts.delete(taskId);
}
