import type {
  LocalAiChatSessionRecord,
  LocalOpLogRecord,
  LocalSyncInboxRecord,
  LocalTaskDraftRecord,
  LocalTaskRecord
} from "@/services/local-db";
import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedString
} from "@/services/local-crypto";

export function shouldEncryptTaskRecord(record: LocalTaskRecord): boolean {
  return (
    !isLocalEncryptedString(record.title) ||
    (typeof record.contentJson === "string" && !isLocalEncryptedString(record.contentJson)) ||
    (typeof record.contentText === "string" && !isLocalEncryptedString(record.contentText))
  );
}

export async function encryptTaskRecord(record: LocalTaskRecord): Promise<LocalTaskRecord> {
  return {
    ...record,
    title: (await encryptLocalString(record.title)) ?? record.title,
    contentJson: (await encryptLocalString(record.contentJson)) ?? null,
    contentText: (await encryptLocalString(record.contentText)) ?? null
  };
}

export async function decryptTaskRecord(record: LocalTaskRecord): Promise<LocalTaskRecord> {
  const title = await decryptLocalString(record.title);
  const contentJson = await decryptLocalString(record.contentJson);
  const contentText = await decryptLocalString(record.contentText);

  return {
    ...record,
    title: typeof title === "string" && title.trim().length > 0 ? title : "未命名任务",
    contentJson: typeof contentJson === "string" ? contentJson : null,
    contentText: typeof contentText === "string" ? contentText : null
  };
}

export function shouldEncryptTaskDraft(record: LocalTaskDraftRecord): boolean {
  return (
    !isLocalEncryptedString(record.title) ||
    (typeof record.contentJson === "string" && !isLocalEncryptedString(record.contentJson)) ||
    !isLocalEncryptedString(record.contentText)
  );
}

export async function encryptTaskDraftRecord(
  record: LocalTaskDraftRecord
): Promise<LocalTaskDraftRecord> {
  return {
    ...record,
    title: (await encryptLocalString(record.title)) ?? record.title,
    contentJson: (await encryptLocalString(record.contentJson)) ?? null,
    contentText: (await encryptLocalString(record.contentText)) ?? ""
  };
}

export async function decryptTaskDraftRecord(
  record: LocalTaskDraftRecord
): Promise<LocalTaskDraftRecord> {
  const title = await decryptLocalString(record.title);
  const contentJson = await decryptLocalString(record.contentJson);
  const contentText = await decryptLocalString(record.contentText);

  return {
    ...record,
    title: typeof title === "string" ? title : "",
    contentJson: typeof contentJson === "string" ? contentJson : null,
    contentText: typeof contentText === "string" ? contentText : ""
  };
}

export function shouldEncryptOpLogRecord(record: LocalOpLogRecord): boolean {
  return !isLocalEncryptedString(record.payload);
}

export async function encryptOpLogRecord(record: LocalOpLogRecord): Promise<LocalOpLogRecord> {
  return {
    ...record,
    payload: (await encryptLocalString(record.payload)) ?? record.payload
  };
}

export async function decryptOpLogRecord(record: LocalOpLogRecord): Promise<LocalOpLogRecord> {
  const payload = await decryptLocalString(record.payload);

  return {
    ...record,
    payload: typeof payload === "string" ? payload : record.payload
  };
}

export function shouldEncryptSyncInboxRecord(record: LocalSyncInboxRecord): boolean {
  return typeof record.payload === "string" && !isLocalEncryptedString(record.payload);
}

export async function encryptSyncInboxRecord(
  record: LocalSyncInboxRecord
): Promise<LocalSyncInboxRecord> {
  return {
    ...record,
    payload: (await encryptLocalString(record.payload)) ?? null
  };
}

export async function decryptSyncInboxRecord(
  record: LocalSyncInboxRecord
): Promise<LocalSyncInboxRecord> {
  const payload = await decryptLocalString(record.payload);

  return {
    ...record,
    payload: typeof payload === "string" ? payload : null
  };
}

export function shouldEncryptAiChatSessionRecord(record: LocalAiChatSessionRecord): boolean {
  return (
    !isLocalEncryptedString(record.messagesJson) ||
    (typeof record.sessionId === "string" && !isLocalEncryptedString(record.sessionId))
  );
}

export async function encryptAiChatSessionRecord(
  record: LocalAiChatSessionRecord
): Promise<LocalAiChatSessionRecord> {
  return {
    ...record,
    sessionId: (await encryptLocalString(record.sessionId)) ?? null,
    messagesJson: (await encryptLocalString(record.messagesJson)) ?? "[]"
  };
}

export async function decryptAiChatSessionRecord(
  record: LocalAiChatSessionRecord
): Promise<LocalAiChatSessionRecord> {
  const sessionId = await decryptLocalString(record.sessionId);
  const messagesJson = await decryptLocalString(record.messagesJson);

  return {
    ...record,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    messagesJson: typeof messagesJson === "string" ? messagesJson : "[]"
  };
}
