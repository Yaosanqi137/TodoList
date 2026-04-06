import { localDb, type LocalAiChatSessionRecord } from "@/services/local-db";
import type { WebAiChannel } from "@/services/ai-api";
import {
  decryptAiChatSessionRecord,
  encryptAiChatSessionRecord,
  shouldEncryptAiChatSessionRecord
} from "@/services/local-sensitive-codec";

export type LocalAiChatMessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
};

export type SaveLocalAiChatSessionInput = {
  userId: string;
  channel: WebAiChannel;
  sessionId: string | null;
  messages: LocalAiChatMessageRecord[];
};

export type LocalAiChatSessionSnapshot = {
  channel: WebAiChannel;
  sessionId: string | null;
  messages: LocalAiChatMessageRecord[];
};

function createSessionKey(userId: string, channel: WebAiChannel): string {
  return `${userId}:${channel}`;
}

function parseMessages(messagesJson: string): LocalAiChatMessageRecord[] {
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is LocalAiChatMessageRecord => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const record = item as Record<string, unknown>;
      return (
        typeof record["id"] === "string" &&
        (record["role"] === "user" ||
          record["role"] === "assistant" ||
          record["role"] === "system") &&
        typeof record["content"] === "string" &&
        (record["meta"] === undefined || typeof record["meta"] === "string")
      );
    });
  } catch {
    return [];
  }
}

function toSnapshot(record: LocalAiChatSessionRecord): LocalAiChatSessionSnapshot {
  return {
    channel: record.channel,
    sessionId: record.sessionId,
    messages: parseMessages(record.messagesJson)
  };
}

export async function listLocalAiChatSessions(
  userId: string
): Promise<LocalAiChatSessionSnapshot[]> {
  const records = await localDb.aiChatSessions.where("userId").equals(userId).toArray();
  const encryptedRecords = await Promise.all(
    records
      .filter(shouldEncryptAiChatSessionRecord)
      .map((record) => encryptAiChatSessionRecord(record))
  );

  if (encryptedRecords.length > 0) {
    await localDb.aiChatSessions.bulkPut(encryptedRecords);
  }

  const decryptedRecords = await Promise.all(
    records.map((record) => decryptAiChatSessionRecord(record))
  );
  return decryptedRecords.map(toSnapshot);
}

export async function saveLocalAiChatSession(
  input: SaveLocalAiChatSessionInput
): Promise<LocalAiChatSessionRecord> {
  const record = await encryptAiChatSessionRecord({
    key: createSessionKey(input.userId, input.channel),
    userId: input.userId,
    channel: input.channel,
    sessionId: input.sessionId,
    messagesJson: JSON.stringify(input.messages),
    updatedAt: Date.now()
  });

  await localDb.aiChatSessions.put(record);
  return record;
}

export async function deleteLocalAiChatSession(
  userId: string,
  channel: WebAiChannel
): Promise<void> {
  await localDb.aiChatSessions.delete(createSessionKey(userId, channel));
}
