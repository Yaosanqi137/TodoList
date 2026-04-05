import request from "supertest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../src/prisma/prisma.service";
import { SyncController } from "../src/sync/sync.controller";
import { SyncService } from "../src/sync/sync.service";

type SyncOperationRecord = {
  id: string;
  opId: string;
  userId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: string | null;
  clientTs: Date;
  serverTs: Date;
};

type SyncOperationSelect = {
  opId?: true;
  entityId?: true;
  entityType?: true;
  action?: true;
  payload?: true;
  clientTs?: true;
  deviceId?: true;
  serverTs?: true;
};

type SyncOperationFindManyArgs = {
  where: {
    userId: string;
    opId?: {
      in: string[];
    };
    OR?: Array<
      | {
          serverTs: {
            gt: Date;
          };
        }
      | {
          serverTs: Date;
          opId: {
            gt: string;
          };
        }
    >;
  };
  select: SyncOperationSelect;
  orderBy?: Array<{
    serverTs?: "asc" | "desc";
    opId?: "asc" | "desc";
  }>;
  take?: number;
};

type SyncOperationCreateArgs = {
  data: {
    opId: string;
    userId: string;
    deviceId: string;
    entityType: string;
    entityId: string;
    action: string;
    payload?: string;
    clientTs: Date;
  };
  select: {
    opId: true;
    serverTs: true;
  };
};

class InMemoryPrismaService {
  private syncOperationIdSequence = 1;
  private syncOperations: SyncOperationRecord[] = [];

  readonly syncOperation = {
    findMany: async (args: SyncOperationFindManyArgs) => {
      let items = this.syncOperations.filter((item) => item.userId === args.where.userId);

      if (args.where.opId?.in) {
        items = items.filter((item) => args.where.opId?.in.includes(item.opId));
      }

      if (args.where.OR && args.where.OR.length > 0) {
        items = items.filter((item) =>
          args.where.OR?.some((condition) => {
            if ("gt" in condition.serverTs) {
              return item.serverTs.getTime() > condition.serverTs.gt.getTime();
            }

            if ("opId" in condition) {
              return (
                item.serverTs.getTime() === condition.serverTs.getTime() &&
                item.opId > condition.opId.gt
              );
            }

            return false;
          })
        );
      }

      if (args.orderBy && args.orderBy.length > 0) {
        items = [...items].sort((left, right) => {
          for (const orderRule of args.orderBy ?? []) {
            if (orderRule.serverTs) {
              const diff = left.serverTs.getTime() - right.serverTs.getTime();
              if (diff !== 0) {
                return orderRule.serverTs === "asc" ? diff : -diff;
              }
            }

            if (orderRule.opId) {
              const diff = left.opId.localeCompare(right.opId);
              if (diff !== 0) {
                return orderRule.opId === "asc" ? diff : -diff;
              }
            }
          }

          return 0;
        });
      }

      const limitedItems = args.take ? items.slice(0, args.take) : items;

      return limitedItems.map((item) => this.pickSelectedFields(item, args.select));
    },

    create: async (args: SyncOperationCreateArgs) => {
      const createdOperation: SyncOperationRecord = {
        id: `sync_${this.syncOperationIdSequence++}`,
        opId: args.data.opId,
        userId: args.data.userId,
        deviceId: args.data.deviceId,
        entityType: args.data.entityType,
        entityId: args.data.entityId,
        action: args.data.action,
        payload: args.data.payload ?? null,
        clientTs: args.data.clientTs,
        serverTs: new Date()
      };

      this.syncOperations.push(createdOperation);

      return {
        opId: createdOperation.opId,
        serverTs: createdOperation.serverTs
      };
    }
  };

  getOperationCount(): number {
    return this.syncOperations.length;
  }

  seedOperations(records: Array<Omit<SyncOperationRecord, "id">>): void {
    for (const record of records) {
      this.syncOperations.push({
        ...record,
        id: `sync_${this.syncOperationIdSequence++}`
      });
    }
  }

  private pickSelectedFields(
    item: SyncOperationRecord,
    select: SyncOperationSelect
  ): Partial<SyncOperationRecord> {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(select) as Array<keyof SyncOperationSelect>) {
      if (!select[key]) {
        continue;
      }

      const recordKey = key as keyof SyncOperationRecord;
      result[recordKey] = item[recordKey];
    }

    return result as Partial<SyncOperationRecord>;
  }
}

describe("SyncController (integration)", () => {
  let app: INestApplication;
  let prismaService: InMemoryPrismaService;

  beforeAll(async () => {
    prismaService = new InMemoryPrismaService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [SyncService, { provide: PrismaService, useValue: prismaService }]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should accept operations once and mark repeated push as duplicate", async () => {
    const payload = {
      operations: [
        {
          opId: "op-create-1",
          entityType: "TASK",
          entityId: "task-1",
          action: "CREATE",
          payload: '{"title":"任务一"}',
          clientTs: 1712419200000,
          deviceId: "device-a"
        },
        {
          opId: "op-update-1",
          entityType: "TASK",
          entityId: "task-1",
          action: "UPDATE",
          payload: '{"title":"任务一-更新"}',
          clientTs: 1712419201000,
          deviceId: "device-a"
        }
      ]
    };

    const firstResponse = await request(app.getHttpServer())
      .post("/sync/push")
      .set("x-user-id", "user-1")
      .send(payload)
      .expect(201);

    expect(firstResponse.body.acceptedCount).toBe(2);
    expect(firstResponse.body.duplicateCount).toBe(0);
    expect(firstResponse.body.failedCount).toBe(0);
    expect(firstResponse.body.results).toEqual([
      expect.objectContaining({
        opId: "op-create-1",
        status: "accepted"
      }),
      expect.objectContaining({
        opId: "op-update-1",
        status: "accepted"
      })
    ]);
    expect(prismaService.getOperationCount()).toBe(2);

    const secondResponse = await request(app.getHttpServer())
      .post("/sync/push")
      .set("x-user-id", "user-1")
      .send(payload)
      .expect(201);

    expect(secondResponse.body.acceptedCount).toBe(0);
    expect(secondResponse.body.duplicateCount).toBe(2);
    expect(secondResponse.body.failedCount).toBe(0);
    expect(secondResponse.body.results).toEqual([
      expect.objectContaining({
        opId: "op-create-1",
        status: "duplicate",
        reason: "already_synced"
      }),
      expect.objectContaining({
        opId: "op-update-1",
        status: "duplicate",
        reason: "already_synced"
      })
    ]);
    expect(prismaService.getOperationCount()).toBe(2);
  });

  it("should mark duplicated op ids in the same batch as duplicate", async () => {
    const response = await request(app.getHttpServer())
      .post("/sync/push")
      .set("x-user-id", "user-2")
      .send({
        operations: [
          {
            opId: "op-dup-1",
            entityType: "TASK",
            entityId: "task-2",
            action: "CREATE",
            payload: '{"title":"任务二"}',
            clientTs: 1712419300000,
            deviceId: "device-b"
          },
          {
            opId: "op-dup-1",
            entityType: "TASK",
            entityId: "task-2",
            action: "UPDATE",
            payload: '{"title":"任务二-重复"}',
            clientTs: 1712419301000,
            deviceId: "device-b"
          }
        ]
      })
      .expect(201);

    expect(response.body.acceptedCount).toBe(1);
    expect(response.body.duplicateCount).toBe(1);
    expect(response.body.failedCount).toBe(0);
    expect(response.body.results[0]).toEqual(
      expect.objectContaining({
        opId: "op-dup-1",
        status: "accepted"
      })
    );
    expect(response.body.results[1]).toEqual(
      expect.objectContaining({
        opId: "op-dup-1",
        status: "duplicate",
        reason: "same_batch_duplicate"
      })
    );
    expect(prismaService.getOperationCount()).toBe(3);
  });

  it("should pull operations incrementally with a stable cursor", async () => {
    prismaService.seedOperations([
      {
        opId: "pull-op-1",
        userId: "user-pull",
        deviceId: "device-c",
        entityType: "TASK",
        entityId: "task-10",
        action: "CREATE",
        payload: '{"title":"任务甲"}',
        clientTs: new Date("2026-04-06T10:00:00.000Z"),
        serverTs: new Date("2026-04-06T10:10:00.000Z")
      },
      {
        opId: "pull-op-2",
        userId: "user-pull",
        deviceId: "device-c",
        entityType: "TASK",
        entityId: "task-10",
        action: "UPDATE",
        payload: '{"title":"任务甲-更新"}',
        clientTs: new Date("2026-04-06T10:01:00.000Z"),
        serverTs: new Date("2026-04-06T10:10:00.000Z")
      },
      {
        opId: "pull-op-3",
        userId: "user-pull",
        deviceId: "device-c",
        entityType: "TASK",
        entityId: "task-11",
        action: "CREATE",
        payload: '{"title":"任务乙"}',
        clientTs: new Date("2026-04-06T10:02:00.000Z"),
        serverTs: new Date("2026-04-06T10:11:00.000Z")
      },
      {
        opId: "pull-op-other-user",
        userId: "user-other",
        deviceId: "device-z",
        entityType: "TASK",
        entityId: "task-99",
        action: "CREATE",
        payload: '{"title":"其他用户任务"}',
        clientTs: new Date("2026-04-06T10:03:00.000Z"),
        serverTs: new Date("2026-04-06T10:12:00.000Z")
      }
    ]);

    const firstResponse = await request(app.getHttpServer())
      .get("/sync/pull")
      .set("x-user-id", "user-pull")
      .query({ limit: 2 })
      .expect(200);

    expect(firstResponse.body.items.map((item: { opId: string }) => item.opId)).toEqual([
      "pull-op-1",
      "pull-op-2"
    ]);
    expect(firstResponse.body.hasMore).toBe(true);
    expect(firstResponse.body.nextCursor).toEqual(expect.any(String));

    const secondResponse = await request(app.getHttpServer())
      .get("/sync/pull")
      .set("x-user-id", "user-pull")
      .query({
        limit: 2,
        cursor: firstResponse.body.nextCursor
      })
      .expect(200);

    expect(secondResponse.body.items.map((item: { opId: string }) => item.opId)).toEqual([
      "pull-op-3"
    ]);
    expect(secondResponse.body.hasMore).toBe(false);
    expect(secondResponse.body.nextCursor).toEqual(expect.any(String));
  });

  it("should reject invalid cursor payload", async () => {
    await request(app.getHttpServer())
      .get("/sync/pull")
      .set("x-user-id", "user-invalid-cursor")
      .query({
        cursor: "not-a-valid-cursor"
      })
      .expect(400);
  });
});
