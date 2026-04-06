import request from "supertest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  AiChannel,
  AiUsageLog,
  AiProviderBinding,
  AiPublicPoolConfig,
  TaskPriority,
  TaskStatus
} from "../generated/prisma/client";
import { AiController } from "../src/ai/ai.controller";
import { AiProviderRegistryService } from "../src/ai/ai-provider-registry.service";
import { AiService } from "../src/ai/ai.service";
import {
  AiChatInput,
  AiChannelExecutor,
  AiResolvedRouteCandidate,
  AiRouteFailureError
} from "../src/ai/ai.types";
import { PrismaService } from "../src/prisma/prisma.service";

type AiUsageLogRecord = {
  id: string;
  userId: string | null;
  channel: AiChannel;
  providerName: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  success: boolean;
  errorCode: string | null;
  createdAt: Date;
};

type AiTaskRecord = {
  userId: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  ddl: Date | null;
  contentText: string | null;
  updatedAt: Date;
};

class InMemoryAiPrismaService {
  private bindingIdSequence = 1;
  private publicPoolIdSequence = 1;
  private usageLogIdSequence = 1;
  private bindings: AiProviderBinding[] = [];
  private publicPools: AiPublicPoolConfig[] = [];
  private usageLogs: AiUsageLogRecord[] = [];
  private tasks: AiTaskRecord[] = [];

  readonly aiProviderBinding = {
    findMany: async (args: {
      where: {
        userId: string;
      };
    }) => {
      return this.bindings
        .filter((binding) => binding.userId === args.where.userId)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    },

    findFirst: async (args: {
      where: {
        id?: string;
        userId?: string;
        channel?: AiChannel;
        isEnabled?: boolean;
      };
    }) => {
      return (
        this.bindings
          .filter((binding) => {
            if (args.where.id !== undefined && binding.id !== args.where.id) {
              return false;
            }
            if (args.where.userId !== undefined && binding.userId !== args.where.userId) {
              return false;
            }
            if (args.where.channel !== undefined && binding.channel !== args.where.channel) {
              return false;
            }
            if (args.where.isEnabled !== undefined && binding.isEnabled !== args.where.isEnabled) {
              return false;
            }
            return true;
          })
          .sort((left, right) => {
            if (left.isDefault !== right.isDefault) {
              return Number(right.isDefault) - Number(left.isDefault);
            }
            return right.updatedAt.getTime() - left.updatedAt.getTime();
          })[0] ?? null
      );
    },

    create: async (args: {
      data: {
        userId: string;
        channel: AiChannel;
        providerName: string;
        model: string | null;
        configId: string | null;
        configName: string | null;
        endpoint: string | null;
        encryptedApiKey: string | null;
        isDefault: boolean;
        isEnabled: boolean;
      };
    }) => {
      const now = new Date();
      const binding: AiProviderBinding = {
        id: `binding_${this.bindingIdSequence++}`,
        userId: args.data.userId,
        channel: args.data.channel,
        providerName: args.data.providerName,
        model: args.data.model,
        configId: args.data.configId,
        configName: args.data.configName,
        encryptedApiKey: args.data.encryptedApiKey,
        endpoint: args.data.endpoint,
        isDefault: args.data.isDefault,
        isEnabled: args.data.isEnabled,
        createdAt: now,
        updatedAt: now
      };

      this.bindings.push(binding);
      return binding;
    },

    update: async (args: {
      where: {
        id: string;
      };
      data: Partial<AiProviderBinding>;
    }) => {
      const binding = this.bindings.find((item) => item.id === args.where.id);
      if (!binding) {
        throw new Error("binding not found");
      }

      Object.assign(binding, args.data, { updatedAt: new Date() });
      return binding;
    },

    updateMany: async (args: {
      where: {
        userId?: string;
        channel?: AiChannel;
        id?: {
          not: string;
        };
      };
      data: {
        isDefault?: boolean;
      };
    }) => {
      let count = 0;
      for (const binding of this.bindings) {
        if (args.where.userId !== undefined && binding.userId !== args.where.userId) {
          continue;
        }
        if (args.where.channel !== undefined && binding.channel !== args.where.channel) {
          continue;
        }
        if (args.where.id?.not !== undefined && binding.id === args.where.id.not) {
          continue;
        }

        if (args.data.isDefault !== undefined) {
          binding.isDefault = args.data.isDefault;
          binding.updatedAt = new Date();
        }
        count += 1;
      }

      return { count };
    }
  };

  readonly aiPublicPoolConfig = {
    findFirst: async (args?: {
      where?: {
        enabled?: boolean;
      };
    }) => {
      const items = this.publicPools
        .filter((item) =>
          args?.where?.enabled === undefined ? true : item.enabled === args.where.enabled
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

      return items[0] ?? null;
    }
  };

  readonly aiUsageLog = {
    create: async (args: { data: Omit<AiUsageLog, "id" | "createdAt"> }) => {
      const usageLog: AiUsageLogRecord = {
        id: `usage_log_${this.usageLogIdSequence++}`,
        createdAt: new Date(),
        ...args.data
      };

      this.usageLogs.push(usageLog);
      return usageLog;
    },

    findMany: async (args: {
      where?: {
        userId?: string;
        channel?: AiChannel;
        success?: boolean;
      };
      orderBy?: {
        createdAt: "asc" | "desc";
      };
      skip?: number;
      take?: number;
    }) => {
      const filteredLogs = this.filterUsageLogs(args.where);
      const sortedLogs = [...filteredLogs].sort((left, right) => {
        const direction = args.orderBy?.createdAt === "asc" ? 1 : -1;
        return (left.createdAt.getTime() - right.createdAt.getTime()) * direction;
      });
      const start = args.skip ?? 0;
      const end = args.take === undefined ? undefined : start + args.take;
      return sortedLogs.slice(start, end);
    },

    count: async (args?: {
      where?: {
        userId?: string;
        channel?: AiChannel;
        success?: boolean;
      };
    }) => {
      return this.filterUsageLogs(args?.where).length;
    }
  };

  readonly task = {
    findMany: async (args: {
      where: {
        userId: string;
        status: {
          in: TaskStatus[];
        };
      };
      take?: number;
    }) => {
      const filteredTasks = this.tasks.filter(
        (task) => task.userId === args.where.userId && args.where.status.in.includes(task.status)
      );

      return filteredTasks.slice(0, args.take ?? filteredTasks.length).map((task) => ({
        title: task.title,
        priority: task.priority,
        status: task.status,
        ddl: task.ddl,
        contentText: task.contentText,
        updatedAt: task.updatedAt
      }));
    }
  };

  async $transaction<T>(callback: (tx: InMemoryAiPrismaService) => Promise<T>): Promise<T> {
    return callback(this);
  }

  seedBinding(binding: Omit<AiProviderBinding, "createdAt" | "updatedAt">): void {
    const now = new Date();
    this.bindings.push({
      ...binding,
      createdAt: now,
      updatedAt: now
    });
  }

  seedPublicPool(publicPool: Omit<AiPublicPoolConfig, "id" | "createdAt" | "updatedAt">): void {
    const now = new Date();
    this.publicPools.push({
      id: `pool_${this.publicPoolIdSequence++}`,
      createdAt: now,
      updatedAt: now,
      ...publicPool
    });
  }

  getUsageLogs(): AiUsageLogRecord[] {
    return [...this.usageLogs];
  }

  seedTask(task: AiTaskRecord): void {
    this.tasks.push(task);
  }

  seedUsageLog(log: Omit<AiUsageLogRecord, "id"> & { id?: string }): void {
    this.usageLogs.push({
      id: log.id ?? `usage_log_${this.usageLogIdSequence++}`,
      ...log
    });
  }

  private filterUsageLogs(where?: {
    userId?: string;
    channel?: AiChannel;
    success?: boolean;
  }): AiUsageLogRecord[] {
    return this.usageLogs.filter((log) => {
      if (where?.userId !== undefined && log.userId !== where.userId) {
        return false;
      }
      if (where?.channel !== undefined && log.channel !== where.channel) {
        return false;
      }
      if (where?.success !== undefined && log.success !== where.success) {
        return false;
      }

      return true;
    });
  }
}

class StaticExecutor implements AiChannelExecutor {
  readonly inputs: Array<{
    candidate: AiResolvedRouteCandidate;
    message: string;
  }> = [];

  constructor(
    private readonly resolver: (channel: AiChannel) => {
      content?: string;
      code?: string;
      message?: string;
    }
  ) {}

  async execute(candidate: AiResolvedRouteCandidate, input: AiChatInput) {
    this.inputs.push({
      candidate,
      message: input.message
    });

    const result = this.resolver(candidate.channel);
    if (result.code) {
      throw new AiRouteFailureError(
        candidate.channel,
        candidate.providerName || candidate.configName || candidate.configId || "unknown",
        result.code,
        result.message ?? "执行失败"
      );
    }

    return {
      channel: candidate.channel,
      providerName: candidate.providerName || candidate.configName || candidate.configId || "",
      model: candidate.model,
      content: result.content ?? "",
      sessionId: "session_ai",
      usage: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20
      },
      raw: null
    };
  }
}

describe("AiController (integration)", () => {
  let app: INestApplication;
  let prismaService: InMemoryAiPrismaService;
  let astrbotExecutor: StaticExecutor;

  beforeEach(async () => {
    prismaService = new InMemoryAiPrismaService();

    const openAiExecutor = new StaticExecutor((channel) =>
      channel === AiChannel.USER_KEY
        ? {
            code: "UPSTREAM_UNREACHABLE",
            message: "用户自备 Key 渠道暂时不可用"
          }
        : {
            content: "公共 AI 已接管"
          }
    );
    astrbotExecutor = new StaticExecutor(() => ({
      content: "AstrBot 已接管"
    }));

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        AiService,
        {
          provide: PrismaService,
          useValue: prismaService
        },
        {
          provide: AiProviderRegistryService,
          useValue: {
            getExecutor: (channel: AiChannel) =>
              channel === AiChannel.ASTRBOT ? astrbotExecutor : openAiExecutor
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

  afterEach(async () => {
    await app.close();
  });

  it("should create and list ai bindings", async () => {
    await request(app.getHttpServer())
      .post("/ai/bindings")
      .set("x-user-id", "user_1")
      .send({
        channel: AiChannel.ASTRBOT,
        providerName: "astrbot-main",
        model: "deepseek-chat",
        configId: "default",
        endpoint: "http://127.0.0.1:6185",
        apiKey: "abk_secret_1234",
        isEnabled: true
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/ai/bindings")
      .set("x-user-id", "user_1")
      .expect(200);

    expect(response.body.routeOrder).toEqual([
      AiChannel.USER_KEY,
      AiChannel.ASTRBOT,
      AiChannel.PUBLIC_POOL
    ]);
    expect(response.body.bindings).toHaveLength(1);
    expect(response.body.bindings[0]).toMatchObject({
      channel: AiChannel.ASTRBOT,
      providerName: "astrbot-main",
      model: "deepseek-chat",
      configId: "default",
      configName: null,
      hasApiKey: true,
      maskedApiKey: "abk_***34",
      isEnabled: true
    });
  });

  it("should hide public pool endpoint from user bindings response", async () => {
    prismaService.seedPublicPool({
      enabled: true,
      providerName: "public-openai",
      model: "gpt-4o-mini",
      encryptedApiKey: "sk-public",
      endpoint: "https://internal.example.com/v1",
      rpmLimit: 60,
      dailyTokenLimit: 100000
    });

    const response = await request(app.getHttpServer())
      .get("/ai/bindings")
      .set("x-user-id", "user_1")
      .expect(200);

    expect(response.body.publicPool).toEqual({
      enabled: true,
      providerName: "public-openai",
      model: "gpt-4o-mini",
      hasApiKey: true
    });
  });

  it("should upsert one binding per user channel", async () => {
    await request(app.getHttpServer())
      .post("/ai/bindings")
      .set("x-user-id", "user_1")
      .send({
        channel: AiChannel.USER_KEY,
        providerName: "openai",
        model: "gpt-4o-mini",
        endpoint: "https://api.example.com",
        apiKey: "sk-first",
        isEnabled: true
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/ai/bindings")
      .set("x-user-id", "user_1")
      .send({
        channel: AiChannel.USER_KEY,
        providerName: "google",
        model: "gemini-2.5-flash",
        endpoint: "https://generativelanguage.googleapis.com",
        apiKey: "sk-second",
        isEnabled: false
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/ai/bindings")
      .set("x-user-id", "user_1")
      .expect(200);

    expect(response.body.bindings).toEqual([
      expect.objectContaining({
        channel: AiChannel.USER_KEY,
        providerName: "google",
        model: "gemini-2.5-flash",
        endpoint: "https://generativelanguage.googleapis.com",
        isEnabled: false,
        maskedApiKey: "sk-s***nd"
      })
    ]);
  });

  it("should fallback from user key to astrbot", async () => {
    prismaService.seedBinding({
      id: "binding_user_key",
      userId: "user_1",
      channel: AiChannel.USER_KEY,
      providerName: "openai",
      model: "gpt-4o-mini",
      configId: null,
      configName: null,
      encryptedApiKey: "sk-user",
      endpoint: "https://api.example.com",
      isDefault: true,
      isEnabled: true
    });
    prismaService.seedBinding({
      id: "binding_astrbot",
      userId: "user_1",
      channel: AiChannel.ASTRBOT,
      providerName: "",
      model: null,
      configId: "default",
      configName: null,
      encryptedApiKey: "abk_astrbot",
      endpoint: "http://127.0.0.1:6185",
      isDefault: true,
      isEnabled: true
    });

    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set("x-user-id", "user_1")
      .send({
        message: "帮我安排今天的任务"
      })
      .expect(201);

    expect(response.body.channel).toBe(AiChannel.ASTRBOT);
    expect(response.body.content).toBe("AstrBot 已接管");
    expect(response.body.attempts).toEqual([
      {
        channel: AiChannel.USER_KEY,
        providerName: "openai",
        model: "gpt-4o-mini",
        status: "failed",
        reasonCode: "UPSTREAM_UNREACHABLE",
        reasonMessage: "用户自备 Key 渠道暂时不可用"
      },
      {
        channel: AiChannel.ASTRBOT,
        providerName: "default",
        model: null,
        status: "success",
        reasonCode: null,
        reasonMessage: null
      }
    ]);
    expect(prismaService.getUsageLogs()).toEqual([
      {
        id: expect.any(String),
        userId: "user_1",
        channel: AiChannel.USER_KEY,
        providerName: "openai",
        model: "gpt-4o-mini",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: expect.any(Number),
        success: false,
        errorCode: "UPSTREAM_UNREACHABLE",
        createdAt: expect.any(Date)
      },
      {
        id: expect.any(String),
        userId: "user_1",
        channel: AiChannel.ASTRBOT,
        providerName: "default",
        model: null,
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        latencyMs: expect.any(Number),
        success: true,
        errorCode: null,
        createdAt: expect.any(Date)
      }
    ]);
  });

  it("should allow astrbot binding with config id only", async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/bindings")
      .set("x-user-id", "user_1")
      .send({
        channel: AiChannel.ASTRBOT,
        configId: "default",
        endpoint: "http://127.0.0.1:6185",
        apiKey: "abk_secret_1234",
        isEnabled: true
      })
      .expect(201);

    expect(response.body).toMatchObject({
      channel: AiChannel.ASTRBOT,
      providerName: "",
      configId: "default",
      configName: null,
      isEnabled: true
    });
  });

  it("should use selected channel without automatic fallback", async () => {
    prismaService.seedBinding({
      id: "binding_user_key_selected",
      userId: "user_1",
      channel: AiChannel.USER_KEY,
      providerName: "openai",
      model: "gpt-4o-mini",
      configId: null,
      configName: null,
      encryptedApiKey: "sk-user",
      endpoint: "https://api.example.com",
      isDefault: false,
      isEnabled: true
    });
    prismaService.seedBinding({
      id: "binding_astrbot_selected",
      userId: "user_1",
      channel: AiChannel.ASTRBOT,
      providerName: "",
      model: null,
      configId: "default",
      configName: null,
      encryptedApiKey: "abk_astrbot",
      endpoint: "http://127.0.0.1:6185",
      isDefault: false,
      isEnabled: true
    });

    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set("x-user-id", "user_1")
      .send({
        message: "只使用自备渠道",
        channel: AiChannel.USER_KEY
      })
      .expect(502);

    expect(response.body.attempts).toEqual([
      {
        channel: AiChannel.USER_KEY,
        providerName: "openai",
        model: "gpt-4o-mini",
        status: "failed",
        reasonCode: "UPSTREAM_UNREACHABLE",
        reasonMessage: "用户自备 Key 渠道暂时不可用"
      }
    ]);
  });

  it("should inject unfinished task summary into ai prompt", async () => {
    prismaService.seedBinding({
      id: "binding_astrbot_context",
      userId: "user_1",
      channel: AiChannel.ASTRBOT,
      providerName: "",
      model: null,
      configId: "default",
      configName: null,
      encryptedApiKey: "abk_astrbot",
      endpoint: "http://127.0.0.1:6185",
      isDefault: true,
      isEnabled: true
    });
    prismaService.seedTask({
      userId: "user_1",
      title: "今晚提交周报",
      priority: TaskPriority.URGENT,
      status: TaskStatus.IN_PROGRESS,
      ddl: new Date("2026-04-06T12:00:00.000Z"),
      contentText: "需要汇总 AI 路由、AstrBot 接入和同步模块进度",
      updatedAt: new Date("2026-04-06T08:00:00.000Z")
    });
    prismaService.seedTask({
      userId: "user_1",
      title: "整理已完成事项",
      priority: TaskPriority.LOW,
      status: TaskStatus.DONE,
      ddl: null,
      contentText: "这条任务不应该出现在上下文里",
      updatedAt: new Date("2026-04-06T07:00:00.000Z")
    });

    await request(app.getHttpServer())
      .post("/ai/chat")
      .set("x-user-id", "user_1")
      .send({
        message: "帮我安排今天剩余任务"
      })
      .expect(201);

    expect(astrbotExecutor.inputs).toHaveLength(1);
    expect(astrbotExecutor.inputs[0]?.message).toContain("以下是系统整理的未完成任务摘要");
    expect(astrbotExecutor.inputs[0]?.message).toContain("今晚提交周报");
    expect(astrbotExecutor.inputs[0]?.message).toContain("优先级：紧急");
    expect(astrbotExecutor.inputs[0]?.message).not.toContain("整理已完成事项");
    expect(astrbotExecutor.inputs[0]?.message).toContain("用户当前问题：帮我安排今天剩余任务");
  });

  it("should return skipped attempts when no channel is available", async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/chat")
      .set("x-user-id", "user_1")
      .send({
        message: "帮我总结今天的安排"
      })
      .expect(502);

    expect(response.body.message).toBe("当前没有可用的 AI 通道，请稍后重试");
    expect(response.body.attempts).toEqual([
      {
        channel: AiChannel.USER_KEY,
        providerName: null,
        model: null,
        status: "skipped",
        reasonCode: "CHANNEL_NOT_CONFIGURED",
        reasonMessage: "当前用户未配置可用的自备 Key 通道"
      },
      {
        channel: AiChannel.ASTRBOT,
        providerName: null,
        model: null,
        status: "skipped",
        reasonCode: "CHANNEL_NOT_CONFIGURED",
        reasonMessage: "当前用户未配置可用的 AstrBot 通道"
      },
      {
        channel: AiChannel.PUBLIC_POOL,
        providerName: null,
        model: null,
        status: "skipped",
        reasonCode: "PUBLIC_POOL_DISABLED",
        reasonMessage: "公共 AI 通道未开启"
      }
    ]);
    expect(prismaService.getUsageLogs()).toEqual([]);
  });
  it("should list usage logs with pagination and filters", async () => {
    prismaService.seedUsageLog({
      id: "usage_log_1",
      userId: "user_1",
      channel: AiChannel.ASTRBOT,
      providerName: "default",
      model: "deepseek-chat",
      promptTokens: 10,
      completionTokens: 6,
      totalTokens: 16,
      latencyMs: 120,
      success: true,
      errorCode: null,
      createdAt: new Date("2026-04-06T08:00:00.000Z")
    });
    prismaService.seedUsageLog({
      id: "usage_log_2",
      userId: "user_1",
      channel: AiChannel.ASTRBOT,
      providerName: "default",
      model: "deepseek-chat",
      promptTokens: 14,
      completionTokens: 9,
      totalTokens: 23,
      latencyMs: 100,
      success: true,
      errorCode: null,
      createdAt: new Date("2026-04-06T09:00:00.000Z")
    });
    prismaService.seedUsageLog({
      id: "usage_log_3",
      userId: "user_1",
      channel: AiChannel.USER_KEY,
      providerName: "openai",
      model: "gpt-4o-mini",
      promptTokens: 20,
      completionTokens: 12,
      totalTokens: 32,
      latencyMs: 210,
      success: false,
      errorCode: "UPSTREAM_UNREACHABLE",
      createdAt: new Date("2026-04-06T10:00:00.000Z")
    });
    prismaService.seedUsageLog({
      id: "usage_log_4",
      userId: "user_2",
      channel: AiChannel.ASTRBOT,
      providerName: "default",
      model: "deepseek-chat",
      promptTokens: 18,
      completionTokens: 11,
      totalTokens: 29,
      latencyMs: 90,
      success: true,
      errorCode: null,
      createdAt: new Date("2026-04-06T11:00:00.000Z")
    });

    const response = await request(app.getHttpServer())
      .get("/ai/usage-logs")
      .set("x-user-id", "user_1")
      .query({
        page: 2,
        pageSize: 1,
        channel: AiChannel.ASTRBOT,
        success: true
      })
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          id: "usage_log_1",
          channel: AiChannel.ASTRBOT,
          providerName: "default",
          model: "deepseek-chat",
          promptTokens: 10,
          completionTokens: 6,
          totalTokens: 16,
          latencyMs: 120,
          success: true,
          errorCode: null,
          createdAt: "2026-04-06T08:00:00.000Z"
        }
      ],
      page: 2,
      pageSize: 1,
      total: 2
    });
  });
});
