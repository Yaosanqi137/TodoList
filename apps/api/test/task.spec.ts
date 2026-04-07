import request from "supertest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../src/prisma/prisma.service";
import { DataEncryptionService } from "../src/security/data-encryption.service";
import { TaskController } from "../src/task/task.controller";
import { TaskService } from "../src/task/task.service";
import { TaskPriority, TaskStatus } from "../generated/prisma/client";

type TaskRecord = {
  id: string;
  userId: string;
  title: string;
  contentJson: unknown | null;
  contentText: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  ddl: Date | null;
  completedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type TagRecord = {
  id: string;
  userId: string;
  name: string;
};

type TaskTagRecord = {
  taskId: string;
  tagId: string;
};

type ListWhereInput = {
  userId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskTags?: {
    some: {
      tag: {
        name: {
          in: string[];
        };
      };
    };
  };
  OR?: Array<{
    title?: {
      contains: string;
      mode?: "insensitive";
    };
    contentText?: {
      contains: string;
      mode?: "insensitive";
    };
  }>;
};

class InMemoryPrismaService {
  private taskIdSequence = 1;
  private tagIdSequence = 1;
  private tasks: TaskRecord[] = [];
  private tags: TagRecord[] = [];
  private taskTags: TaskTagRecord[] = [];

  readonly task = {
    findMany: async (args: {
      where?: ListWhereInput;
      orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc"; ddl?: "asc" | "desc" };
      skip?: number;
      take?: number;
    }) => {
      const where = args.where;
      const skip = args.skip ?? 0;
      const take = args.take ?? 20;
      let filtered = [...this.tasks];

      if (where?.userId) {
        filtered = filtered.filter((task) => task.userId === where.userId);
      }
      if (where?.status) {
        filtered = filtered.filter((task) => task.status === where.status);
      }
      if (where?.priority) {
        filtered = filtered.filter((task) => task.priority === where.priority);
      }
      if (where?.taskTags?.some.tag.name.in) {
        const expectedTags = new Set(where.taskTags.some.tag.name.in);
        filtered = filtered.filter((task) => {
          const taskTagNames = this.getTaskTagNames(task.id);
          return taskTagNames.some((tagName) => expectedTags.has(tagName));
        });
      }
      if (where?.OR && where.OR.length > 0) {
        filtered = filtered.filter((task) =>
          where.OR!.some((orCondition) => {
            if (orCondition.title?.contains) {
              return task.title.toLowerCase().includes(orCondition.title.contains.toLowerCase());
            }
            if (orCondition.contentText?.contains) {
              return (
                task.contentText
                  ?.toLowerCase()
                  .includes(orCondition.contentText.contains.toLowerCase()) ?? false
              );
            }
            return false;
          })
        );
      }

      if (args.orderBy) {
        const [orderField, orderDirection] = Object.entries(args.orderBy)[0] as [
          "createdAt" | "updatedAt" | "ddl",
          "asc" | "desc"
        ];
        filtered.sort((left, right) => {
          const leftValue = left[orderField];
          const rightValue = right[orderField];

          if (leftValue === null && rightValue === null) {
            return 0;
          }
          if (leftValue === null) {
            return 1;
          }
          if (rightValue === null) {
            return -1;
          }

          const diff = leftValue.getTime() - rightValue.getTime();
          return orderDirection === "asc" ? diff : -diff;
        });
      }

      return filtered.slice(skip, skip + take).map((task) => this.toTaskWithTags(task));
    },

    count: async (args: { where?: ListWhereInput }) => {
      const results = await this.task.findMany({
        where: args.where,
        skip: 0,
        take: Number.MAX_SAFE_INTEGER
      });
      return results.length;
    },

    findFirst: async (args: {
      where: {
        id?: string;
        userId?: string;
      };
      select?: {
        id?: boolean;
        status?: boolean;
      };
    }) => {
      const task = this.tasks.find(
        (item) =>
          (args.where.id === undefined || item.id === args.where.id) &&
          (args.where.userId === undefined || item.userId === args.where.userId)
      );
      if (!task) {
        return null;
      }

      if (args.select) {
        return {
          id: args.select.id ? task.id : undefined,
          status: args.select.status ? task.status : undefined
        };
      }

      return this.toTaskWithTags(task);
    },

    create: async (args: {
      data: {
        userId: string;
        title: string;
        contentJson?: unknown;
        contentText: string | null;
        priority: TaskPriority;
        status: TaskStatus;
        ddl: Date | null;
        completedAt: Date | null;
      };
    }) => {
      const now = new Date();
      const task: TaskRecord = {
        id: `task_${this.taskIdSequence++}`,
        userId: args.data.userId,
        title: args.data.title,
        contentJson: args.data.contentJson ?? null,
        contentText: args.data.contentText,
        priority: args.data.priority,
        status: args.data.status,
        ddl: args.data.ddl,
        completedAt: args.data.completedAt,
        version: 1,
        createdAt: now,
        updatedAt: now
      };
      this.tasks.push(task);
      return task;
    },

    update: async (args: {
      where: {
        id: string;
      };
      data: {
        title?: string;
        contentJson?: unknown;
        contentText?: string | null;
        priority?: TaskPriority;
        status?: TaskStatus;
        ddl?: Date | null;
        completedAt?: Date | null;
        version?: {
          increment: number;
        };
      };
    }) => {
      const task = this.tasks.find((item) => item.id === args.where.id);
      if (!task) {
        throw new Error("task not found");
      }

      if (args.data.title !== undefined) {
        task.title = args.data.title;
      }
      if (args.data.contentJson !== undefined) {
        task.contentJson = args.data.contentJson;
      }
      if (args.data.contentText !== undefined) {
        task.contentText = args.data.contentText;
      }
      if (args.data.priority !== undefined) {
        task.priority = args.data.priority;
      }
      if (args.data.status !== undefined) {
        task.status = args.data.status;
      }
      if (args.data.ddl !== undefined) {
        task.ddl = args.data.ddl;
      }
      if (args.data.completedAt !== undefined) {
        task.completedAt = args.data.completedAt;
      }
      if (args.data.version !== undefined) {
        task.version += args.data.version.increment;
      }
      task.updatedAt = new Date();

      return task;
    },

    deleteMany: async (args: {
      where: {
        id: string;
        userId: string;
      };
    }) => {
      const beforeCount = this.tasks.length;
      this.tasks = this.tasks.filter(
        (task) => !(task.id === args.where.id && task.userId === args.where.userId)
      );
      this.taskTags = this.taskTags.filter((taskTag) => taskTag.taskId !== args.where.id);
      return {
        count: beforeCount - this.tasks.length
      };
    },

    findUniqueOrThrow: async (args: {
      where: {
        id: string;
      };
    }) => {
      const task = this.tasks.find((item) => item.id === args.where.id);
      if (!task) {
        throw new Error("task not found");
      }

      return this.toTaskWithTags(task);
    }
  };

  readonly tag = {
    upsert: async (args: {
      where: {
        userId_name: {
          userId: string;
          name: string;
        };
      };
      create: {
        userId: string;
        name: string;
      };
    }) => {
      const existing = this.tags.find(
        (tag) =>
          tag.userId === args.where.userId_name.userId && tag.name === args.where.userId_name.name
      );
      if (existing) {
        return existing;
      }

      const createdTag: TagRecord = {
        id: `tag_${this.tagIdSequence++}`,
        userId: args.create.userId,
        name: args.create.name
      };
      this.tags.push(createdTag);
      return createdTag;
    }
  };

  readonly taskTag = {
    deleteMany: async (args: {
      where: {
        taskId: string;
      };
    }) => {
      const beforeCount = this.taskTags.length;
      this.taskTags = this.taskTags.filter((taskTag) => taskTag.taskId !== args.where.taskId);
      return {
        count: beforeCount - this.taskTags.length
      };
    },

    createMany: async (args: {
      data: Array<{
        taskId: string;
        tagId: string;
      }>;
    }) => {
      for (const row of args.data) {
        const existing = this.taskTags.find(
          (taskTag) => taskTag.taskId === row.taskId && taskTag.tagId === row.tagId
        );
        if (!existing) {
          this.taskTags.push(row);
        }
      }
      return {
        count: args.data.length
      };
    }
  };

  async $transaction<T>(runner: (tx: InMemoryPrismaService) => Promise<T>): Promise<T> {
    return runner(this);
  }

  getRawTaskById(taskId: string): TaskRecord | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  private toTaskWithTags(
    task: TaskRecord
  ): TaskRecord & { taskTags: Array<{ tag: { name: string } }> } {
    return {
      ...task,
      taskTags: this.taskTags
        .filter((taskTag) => taskTag.taskId === task.id)
        .map((taskTag) => this.tags.find((tag) => tag.id === taskTag.tagId))
        .filter((tag): tag is TagRecord => tag !== undefined)
        .map((tag) => ({
          tag: {
            name: tag.name
          }
        }))
    };
  }

  private getTaskTagNames(taskId: string): string[] {
    return this.taskTags
      .filter((taskTag) => taskTag.taskId === taskId)
      .map((taskTag) => this.tags.find((tag) => tag.id === taskTag.tagId))
      .filter((tag): tag is TagRecord => tag !== undefined)
      .map((tag) => tag.name);
  }
}

describe("TaskController (integration)", () => {
  let app: INestApplication;
  const prismaService = new InMemoryPrismaService();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        TaskService,
        DataEncryptionService,
        { provide: PrismaService, useValue: prismaService as unknown as PrismaService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === "DATA_ENCRYPTION_SECRET" ? "test-data-encryption-secret" : undefined
          }
        }
      ]
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

  it("should create, query, update and delete a task", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/tasks")
      .set("x-user-id", "user_1")
      .send({
        title: "准备周会",
        contentText: "整理本周进度",
        priority: "HIGH",
        tagNames: ["工作", "会议"]
      })
      .expect(201);

    expect(createResponse.body.id).toBeDefined();
    expect(createResponse.body.tags).toEqual(["工作", "会议"]);
    const taskId = createResponse.body.id as string;
    const rawCreatedTask = prismaService.getRawTaskById(taskId);
    expect(rawCreatedTask?.title).not.toBe("准备周会");
    expect(rawCreatedTask?.contentText).not.toBe("整理本周进度");

    const listResponse = await request(app.getHttpServer())
      .get("/tasks")
      .set("x-user-id", "user_1")
      .query({ tags: "会议" })
      .expect(200);

    expect(listResponse.body.total).toBe(1);
    expect(listResponse.body.items[0].id).toBe(taskId);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set("x-user-id", "user_1")
      .send({
        status: "DONE"
      })
      .expect(200);

    expect(updateResponse.body.status).toBe("DONE");
    expect(updateResponse.body.completedAt).toBeTruthy();
    expect(updateResponse.body.version).toBe(2);

    await request(app.getHttpServer())
      .delete(`/tasks/${taskId}`)
      .set("x-user-id", "user_1")
      .expect(200)
      .expect({
        success: true
      });

    const listAfterDeleteResponse = await request(app.getHttpServer())
      .get("/tasks")
      .set("x-user-id", "user_1")
      .expect(200);
    expect(listAfterDeleteResponse.body.total).toBe(0);
  });
});
