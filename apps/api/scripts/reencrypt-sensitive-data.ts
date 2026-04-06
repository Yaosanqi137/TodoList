import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { DataEncryptionService } from "../src/security/data-encryption.service";

type MigrationCounter = Record<
  "aiBindings" | "publicPools" | "tasks" | "attachments" | "syncOperations",
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
    aiBindings: 0,
    publicPools: 0,
    tasks: 0,
    attachments: 0,
    syncOperations: 0
  };

  try {
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

      if (providerName !== undefined) {
        data.providerName = providerName;
      }
      if (model !== undefined) {
        data.model = model;
      }
      if (configId !== undefined) {
        data.configId = configId;
      }
      if (configName !== undefined) {
        data.configName = configName;
      }
      if (endpoint !== undefined) {
        data.endpoint = endpoint;
      }
      if (encryptedApiKey !== undefined) {
        data.encryptedApiKey = encryptedApiKey;
      }

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

      if (providerName !== undefined) {
        data.providerName = providerName;
      }
      if (model !== undefined) {
        data.model = model;
      }
      if (endpoint !== undefined) {
        data.endpoint = endpoint;
      }
      if (encryptedApiKey !== undefined) {
        data.encryptedApiKey = encryptedApiKey;
      }

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

      if (title !== undefined) {
        data.title = title;
      }
      if (contentJson !== undefined) {
        data.contentJson = contentJson;
      }
      if (contentText !== undefined) {
        data.contentText = contentText;
      }

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

      if (url !== undefined) {
        data.url = url;
      }
      if (fileName !== undefined) {
        data.fileName = fileName;
      }
      if (checksum !== undefined) {
        data.checksum = checksum;
      }

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
