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
  payload?: string;
  clientTs: Date;
  serverTs: Date;
};

class InMemoryPrismaService {
  private syncOperationIdSequence = 1;
  private syncOperations: SyncOperationRecord[] = [];

  readonly syncOperation = {
    findMany: async (args: {
      where: {
        userId: string;
        opId: {
          in: string[];
        };
      };
      select: {
        opId: true;
        serverTs: true;
      };
    }) => {
      return this.syncOperations
        .filter(
          (item) => item.userId === args.where.userId && args.where.opId.in.includes(item.opId)
        )
        .map((item) => ({
          opId: item.opId,
          serverTs: item.serverTs
        }));
    },

    create: async (args: {
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
    }) => {
      const createdOperation: SyncOperationRecord = {
        id: `sync_${this.syncOperationIdSequence++}`,
        opId: args.data.opId,
        userId: args.data.userId,
        deviceId: args.data.deviceId,
        entityType: args.data.entityType,
        entityId: args.data.entityId,
        action: args.data.action,
        payload: args.data.payload,
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
});
