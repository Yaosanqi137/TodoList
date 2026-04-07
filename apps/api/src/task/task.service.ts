import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Prisma, TaskPriority, TaskStatus } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DataEncryptionService } from "../security/data-encryption.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { ListTasksQueryDto, TaskSortBy, TaskSortOrder } from "./dto/list-tasks-query.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";

type TaskEntity = Prisma.TaskGetPayload<{
  include: {
    taskTags: {
      include: {
        tag: {
          select: {
            name: true;
          };
        };
      };
    };
  };
}>;

export type TaskResponse = {
  id: string;
  title: string;
  contentJson: unknown | null;
  contentText: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  ddl: string | null;
  completedAt: string | null;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ListTasksResponse = {
  items: TaskResponse[];
  page: number;
  pageSize: number;
  total: number;
};

@Injectable()
export class TaskService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataEncryptionService: DataEncryptionService
  ) {}

  async listTasks(userId: string, query: ListTasksQueryDto): Promise<ListTasksResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const keyword = query.keyword?.trim() ?? "";

    const where = this.buildWhereInput(userId, query, keyword.length === 0);
    const orderBy = this.buildOrderByInput(query);

    if (keyword.length > 0) {
      const items = await this.prismaService.task.findMany({
        where,
        orderBy,
        include: {
          taskTags: {
            include: {
              tag: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      });

      const serializedItems = items.map((item: TaskEntity) => this.serializeTask(item));
      const filteredItems = serializedItems.filter((item) => this.matchesKeyword(item, keyword));

      return {
        items: filteredItems.slice(skip, skip + pageSize),
        page,
        pageSize,
        total: filteredItems.length
      };
    }

    const [items, total] = await Promise.all([
      this.prismaService.task.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          taskTags: {
            include: {
              tag: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }),
      this.prismaService.task.count({ where })
    ]);

    return {
      items: items.map((item: TaskEntity) => this.serializeTask(item)),
      page,
      pageSize,
      total
    };
  }

  async getTaskById(userId: string, taskId: string): Promise<TaskResponse> {
    const task = await this.prismaService.task.findFirst({
      where: {
        id: taskId,
        userId
      },
      include: {
        taskTags: {
          include: {
            tag: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("任务不存在");
    }

    return this.serializeTask(task);
  }

  async createTask(userId: string, body: CreateTaskDto): Promise<TaskResponse> {
    const tagNames = this.normalizeTagNames(body.tagNames);
    const nextStatus = body.status ?? TaskStatus.TODO;
    const contentJson =
      body.contentJson !== undefined
        ? ((this.dataEncryptionService.encryptJson(body.contentJson as Prisma.InputJsonValue) ??
            Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput)
        : undefined;

    const task = await this.prismaService.$transaction(async (tx) => {
      const createdTask = await tx.task.create({
        data: {
          userId,
          title: this.encryptRequiredString(body.title),
          contentJson,
          contentText: this.encryptNullableString(body.contentText),
          priority: body.priority ?? TaskPriority.MEDIUM,
          status: nextStatus,
          ddl: body.ddl ? new Date(body.ddl) : null,
          completedAt: nextStatus === TaskStatus.DONE ? new Date() : null
        }
      });

      await this.replaceTaskTags(tx, userId, createdTask.id, tagNames);

      return tx.task.findUniqueOrThrow({
        where: { id: createdTask.id },
        include: {
          taskTags: {
            include: {
              tag: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      });
    });

    return this.serializeTask(task);
  }

  async updateTask(userId: string, taskId: string, body: UpdateTaskDto): Promise<TaskResponse> {
    const currentTask = await this.prismaService.task.findFirst({
      where: {
        id: taskId,
        userId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!currentTask) {
      throw new NotFoundException("任务不存在");
    }

    const data: Prisma.TaskUpdateInput = {
      version: {
        increment: 1
      }
    };

    if (body.title !== undefined) {
      data.title = this.encryptRequiredString(body.title);
    }
    if (body.contentJson !== undefined) {
      data.contentJson = (this.dataEncryptionService.encryptJson(
        body.contentJson as Prisma.InputJsonValue
      ) ?? Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    }
    if (body.contentText !== undefined) {
      data.contentText = this.encryptNullableString(body.contentText);
    }
    if (body.priority !== undefined) {
      data.priority = body.priority;
    }
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === TaskStatus.DONE && currentTask.status !== TaskStatus.DONE) {
        data.completedAt = new Date();
      } else if (body.status !== TaskStatus.DONE) {
        data.completedAt = null;
      }
    }
    if (body.ddl !== undefined) {
      data.ddl = body.ddl ? new Date(body.ddl) : null;
    }

    const shouldReplaceTags = body.tagNames !== undefined;
    const nextTagNames = this.normalizeTagNames(body.tagNames);

    const task = await this.prismaService.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data
      });

      if (shouldReplaceTags) {
        await this.replaceTaskTags(tx, userId, taskId, nextTagNames);
      }

      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          taskTags: {
            include: {
              tag: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      });
    });

    return this.serializeTask(task);
  }

  async deleteTask(userId: string, taskId: string): Promise<{ success: boolean }> {
    const deleted = await this.prismaService.task.deleteMany({
      where: {
        id: taskId,
        userId
      }
    });

    if (deleted.count === 0) {
      throw new NotFoundException("任务不存在");
    }

    return { success: true };
  }

  private buildWhereInput(
    userId: string,
    query: ListTasksQueryDto,
    includeKeyword: boolean
  ): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {
      userId
    };

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.priority !== undefined) {
      where.priority = query.priority;
    }

    if (query.tags !== undefined && query.tags.length > 0) {
      where.taskTags = {
        some: {
          tag: {
            name: {
              in: query.tags
            }
          }
        }
      };
    }

    if (includeKeyword && query.keyword !== undefined && query.keyword.length > 0) {
      where.OR = [
        {
          title: {
            contains: query.keyword,
            mode: "insensitive"
          }
        },
        {
          contentText: {
            contains: query.keyword,
            mode: "insensitive"
          }
        }
      ];
    }

    return where;
  }

  private buildOrderByInput(query: ListTasksQueryDto): Prisma.TaskOrderByWithRelationInput {
    const order: Prisma.SortOrder =
      query.sortOrder === TaskSortOrder.ASC ? Prisma.SortOrder.asc : Prisma.SortOrder.desc;

    if (query.sortBy === TaskSortBy.CREATED_AT) {
      return { createdAt: order };
    }

    if (query.sortBy === TaskSortBy.DDL) {
      return { ddl: order };
    }

    return { updatedAt: order };
  }

  private normalizeTagNames(tagNames: string[] | undefined): string[] {
    if (!tagNames) {
      return [];
    }

    const result: string[] = [];
    const uniqueNames = new Set<string>();

    for (const rawTagName of tagNames) {
      const normalized = rawTagName.trim();
      if (!normalized) {
        continue;
      }

      const uniqueKey = normalized.toLocaleLowerCase();
      if (uniqueNames.has(uniqueKey)) {
        continue;
      }

      uniqueNames.add(uniqueKey);
      result.push(normalized);
    }

    return result;
  }

  private async replaceTaskTags(
    tx: Prisma.TransactionClient,
    userId: string,
    taskId: string,
    tagNames: string[]
  ): Promise<void> {
    await tx.taskTag.deleteMany({
      where: {
        taskId
      }
    });

    if (tagNames.length === 0) {
      return;
    }

    const tags = await Promise.all(
      tagNames.map((name) =>
        tx.tag.upsert({
          where: {
            userId_name: {
              userId,
              name
            }
          },
          update: {},
          create: {
            userId,
            name
          }
        })
      )
    );

    await tx.taskTag.createMany({
      data: tags.map((tag: { id: string }) => ({
        taskId,
        tagId: tag.id
      })),
      skipDuplicates: true
    });
  }

  private serializeTask(task: TaskEntity): TaskResponse {
    return {
      id: task.id,
      title: this.readDecryptedString(task.title) ?? "未命名任务",
      contentJson: this.dataEncryptionService.decryptJson(task.contentJson),
      contentText: this.readDecryptedString(task.contentText),
      priority: task.priority,
      status: task.status,
      ddl: task.ddl?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      version: task.version,
      tags: task.taskTags.map((taskTag: { tag: { name: string } }) => taskTag.tag.name),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString()
    };
  }

  private encryptRequiredString(value: string): string {
    const encryptedValue = this.dataEncryptionService.encryptString(value);
    if (!encryptedValue) {
      throw new InternalServerErrorException("任务字段加密失败");
    }

    return encryptedValue;
  }

  private encryptNullableString(value: string | null | undefined): string | null | undefined {
    return this.dataEncryptionService.encryptString(value);
  }

  private readDecryptedString(value: string | null): string | null {
    const decryptedValue = this.dataEncryptionService.decryptString(value);
    return typeof decryptedValue === "string" ? decryptedValue : null;
  }

  private matchesKeyword(task: TaskResponse, keyword: string): boolean {
    const lowerKeyword = keyword.toLocaleLowerCase();
    return (
      task.title.toLocaleLowerCase().includes(lowerKeyword) ||
      task.contentText?.toLocaleLowerCase().includes(lowerKeyword) === true
    );
  }
}
