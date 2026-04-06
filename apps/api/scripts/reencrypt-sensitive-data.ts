import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { DataEncryptionService } from "../src/security/data-encryption.service";

type MigrationCounter = Record<
  | "users"
  | "authIdentities"
  | "aiBindings"
  | "publicPools"
  | "aiUsageLogs"
  | "tasks"
  | "attachments"
  | "syncOperations",
  number
>;

function createEncryptionService(): DataEncryptionService {
  const configService = {
    get: (key: string) => process.env[key]
  } as ConfigService;

  return new DataEncryptionService(configService);
}

function encryptStringIfNeeded(
  value: string | null,
  dataEncryptionService: DataEncryptionService
): string | null | undefined {
  if (value === null || dataEncryptionService.isEncryptedString(value)) {
    return undefined;
  }

  return dataEncryptionService.encryptString(value) ?? null;
}

function assignRequiredEncryptedString<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  key: K,
  value: string | null | undefined
): void {
  if (typeof value === "string") {
    target[key] = value as T[K];
  }
}

function assignOptionalEncryptedString<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  key: K,
  value: string | null | undefined
): void {
  if (value !== undefined) {
    target[key] = value as T[K];
  }
}

function encryptJsonIfNeeded(
  value: Prisma.JsonValue | null,
  dataEncryptionService: DataEncryptionService
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === null) {
    return undefined;
  }

  if (typeof value === "string" && dataEncryptionService.isEncryptedString(value)) {
    return undefined;
  }

  return (dataEncryptionService.encryptJson(value as Prisma.InputJsonValue) ?? Prisma.JsonNull) as
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput;
}

function resolvePlainString(
  value: string | null,
  dataEncryptionService: DataEncryptionService
): string | null {
  if (value === null) {
    return null;
  }

  return dataEncryptionService.isEncryptedString(value)
    ? (dataEncryptionService.decryptString(value) ?? null)
    : value;
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("缺少 DATABASE_URL，无法执行敏感数据迁移");
  }

  if (!process.env["DATA_ENCRYPTION_SECRET"]) {
    throw new Error("缺少 DATA_ENCRYPTION_SECRET，无法执行敏感数据迁移");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env["DATABASE_URL"]
    })
  });
  const dataEncryptionService = createEncryptionService();
  const counter: MigrationCounter = {
    users: 0,
    authIdentities: 0,
    aiBindings: 0,
    publicPools: 0,
    aiUsageLogs: 0,
    tasks: 0,
    attachments: 0,
    syncOperations: 0
  };

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        emailHash: true,
        nickname: true,
        avatarUrl: true
      }
    });

    for (const user of users) {
      const normalizedEmail = resolvePlainString(user.email, dataEncryptionService)?.toLowerCase();
      if (!normalizedEmail) {
        continue;
      }
      const nextEmailHash = dataEncryptionService.createLookupHash("user.email", normalizedEmail);
      const data: Prisma.UserUpdateInput = {};
      const email = encryptStringIfNeeded(user.email, dataEncryptionService);
      const nickname = encryptStringIfNeeded(user.nickname, dataEncryptionService);
      const avatarUrl = encryptStringIfNeeded(user.avatarUrl, dataEncryptionService);

      assignRequiredEncryptedString(data, "email", email);
      if (user.emailHash !== nextEmailHash) {
        data.emailHash = nextEmailHash;
      }
      assignOptionalEncryptedString(data, "nickname", nickname);
      assignOptionalEncryptedString(data, "avatarUrl", avatarUrl);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.user.update({
        where: {
          id: user.id
        },
        data
      });
      counter.users += 1;
    }

    const authIdentities = await prisma.authIdentity.findMany({
      select: {
        id: true,
        email: true,
        emailHash: true
      }
    });

    for (const authIdentity of authIdentities) {
      const data: Prisma.AuthIdentityUpdateInput = {};
      const email = encryptStringIfNeeded(authIdentity.email, dataEncryptionService);
      const normalizedIdentityEmail = resolvePlainString(authIdentity.email, dataEncryptionService);
      const nextEmailHash =
        normalizedIdentityEmail === null
          ? null
          : dataEncryptionService.createLookupHash(
              "auth_identity.email",
              normalizedIdentityEmail.toLowerCase()
            );

      assignOptionalEncryptedString(data, "email", email);
      if (authIdentity.emailHash !== nextEmailHash) {
        data.emailHash = nextEmailHash;
      }

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.authIdentity.update({
        where: {
          id: authIdentity.id
        },
        data
      });
      counter.authIdentities += 1;
    }

    const aiBindings = await prisma.aiProviderBinding.findMany({
      select: {
        id: true,
        providerName: true,
        model: true,
        configId: true,
        configName: true,
        endpoint: true,
        encryptedApiKey: true
      }
    });

    for (const binding of aiBindings) {
      const data: Prisma.AiProviderBindingUpdateInput = {};
      const providerName = encryptStringIfNeeded(binding.providerName, dataEncryptionService);
      const model = encryptStringIfNeeded(binding.model, dataEncryptionService);
      const configId = encryptStringIfNeeded(binding.configId, dataEncryptionService);
      const configName = encryptStringIfNeeded(binding.configName, dataEncryptionService);
      const endpoint = encryptStringIfNeeded(binding.endpoint, dataEncryptionService);
      const encryptedApiKey = encryptStringIfNeeded(binding.encryptedApiKey, dataEncryptionService);

      assignRequiredEncryptedString(data, "providerName", providerName);
      assignOptionalEncryptedString(data, "model", model);
      assignOptionalEncryptedString(data, "configId", configId);
      assignOptionalEncryptedString(data, "configName", configName);
      assignOptionalEncryptedString(data, "endpoint", endpoint);
      assignOptionalEncryptedString(data, "encryptedApiKey", encryptedApiKey);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.aiProviderBinding.update({
        where: {
          id: binding.id
        },
        data
      });
      counter.aiBindings += 1;
    }

    const publicPools = await prisma.aiPublicPoolConfig.findMany({
      select: {
        id: true,
        providerName: true,
        model: true,
        endpoint: true,
        encryptedApiKey: true
      }
    });

    for (const publicPool of publicPools) {
      const data: Prisma.AiPublicPoolConfigUpdateInput = {};
      const providerName = encryptStringIfNeeded(publicPool.providerName, dataEncryptionService);
      const model = encryptStringIfNeeded(publicPool.model, dataEncryptionService);
      const endpoint = encryptStringIfNeeded(publicPool.endpoint, dataEncryptionService);
      const encryptedApiKey = encryptStringIfNeeded(
        publicPool.encryptedApiKey,
        dataEncryptionService
      );

      assignOptionalEncryptedString(data, "providerName", providerName);
      assignOptionalEncryptedString(data, "model", model);
      assignOptionalEncryptedString(data, "endpoint", endpoint);
      assignOptionalEncryptedString(data, "encryptedApiKey", encryptedApiKey);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.aiPublicPoolConfig.update({
        where: {
          id: publicPool.id
        },
        data
      });
      counter.publicPools += 1;
    }

    const aiUsageLogs = await prisma.aiUsageLog.findMany({
      select: {
        id: true,
        providerName: true,
        model: true
      }
    });

    for (const aiUsageLog of aiUsageLogs) {
      const data: Prisma.AiUsageLogUpdateInput = {};
      const providerName = encryptStringIfNeeded(aiUsageLog.providerName, dataEncryptionService);
      const model = encryptStringIfNeeded(aiUsageLog.model, dataEncryptionService);

      assignOptionalEncryptedString(data, "providerName", providerName);
      assignOptionalEncryptedString(data, "model", model);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.aiUsageLog.update({
        where: {
          id: aiUsageLog.id
        },
        data
      });
      counter.aiUsageLogs += 1;
    }

    const tasks = await prisma.task.findMany({
      select: {
        id: true,
        title: true,
        contentJson: true,
        contentText: true
      }
    });

    for (const task of tasks) {
      const data: Prisma.TaskUpdateInput = {};
      const title = encryptStringIfNeeded(task.title, dataEncryptionService);
      const contentJson = encryptJsonIfNeeded(task.contentJson, dataEncryptionService);
      const contentText = encryptStringIfNeeded(task.contentText, dataEncryptionService);

      assignRequiredEncryptedString(data, "title", title);
      if (contentJson !== undefined) {
        data.contentJson = contentJson;
      }
      assignOptionalEncryptedString(data, "contentText", contentText);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.task.update({
        where: {
          id: task.id
        },
        data
      });
      counter.tasks += 1;
    }

    const attachments = await prisma.attachment.findMany({
      select: {
        id: true,
        url: true,
        fileName: true,
        checksum: true
      }
    });

    for (const attachment of attachments) {
      const data: Prisma.AttachmentUpdateInput = {};
      const url = encryptStringIfNeeded(attachment.url, dataEncryptionService);
      const fileName = encryptStringIfNeeded(attachment.fileName, dataEncryptionService);
      const checksum = encryptStringIfNeeded(attachment.checksum, dataEncryptionService);

      assignRequiredEncryptedString(data, "url", url);
      assignOptionalEncryptedString(data, "fileName", fileName);
      assignOptionalEncryptedString(data, "checksum", checksum);

      if (Object.keys(data).length === 0) {
        continue;
      }

      await prisma.attachment.update({
        where: {
          id: attachment.id
        },
        data
      });
      counter.attachments += 1;
    }

    const syncOperations = await prisma.syncOperation.findMany({
      select: {
        id: true,
        payload: true
      }
    });

    for (const operation of syncOperations) {
      if (operation.payload === null) {
        continue;
      }

      let nextPayload: string | null = null;
      if (typeof operation.payload === "string") {
        if (dataEncryptionService.isEncryptedString(operation.payload)) {
          continue;
        }

        nextPayload = dataEncryptionService.encryptString(operation.payload) ?? null;
      } else {
        nextPayload =
          dataEncryptionService.encryptString(JSON.stringify(operation.payload)) ?? null;
      }

      if (nextPayload === null) {
        continue;
      }

      await prisma.syncOperation.update({
        where: {
          id: operation.id
        },
        data: {
          payload: nextPayload
        }
      });
      counter.syncOperations += 1;
    }

    console.log("敏感数据迁移完成");
    console.log(JSON.stringify(counter, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知错误";
  console.error(`敏感数据迁移失败：${message}`);
  process.exitCode = 1;
});
