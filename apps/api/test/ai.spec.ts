import request from "supertest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AiChannel, AiProviderBinding, AiPublicPoolConfig } from "../generated/prisma/client";
import { AiController } from "../src/ai/ai.controller";
import { AiProviderRegistryService } from "../src/ai/ai-provider-registry.service";
import { AiService } from "../src/ai/ai.service";
import {
  AiChannelExecutor,
  AiResolvedRouteCandidate,
  AiRouteFailureError
} from "../src/ai/ai.types";
import { PrismaService } from "../src/prisma/prisma.service";

type AiUsageLogRecord = {
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
};

class InMemoryAiPrismaService {
  private bindingIdSequence = 1;
  private publicPoolIdSequence = 1;
  private bindings: AiProviderBinding[] = [];
  private publicPools: AiPublicPoolConfig[] = [];
  private usageLogs: AiUsageLogRecord[] = [];

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
    create: async (args: { data: AiUsageLogRecord }) => {
      this.usageLogs.push(args.data);
      return args.data;
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
}

class StaticExecutor implements AiChannelExecutor {
  constructor(
    private readonly resolver: (channel: AiChannel) => {
      content?: string;
      code?: string;
      message?: string;
    }
  ) {}

  async execute(candidate: AiResolvedRouteCandidate) {
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
    const astrbotExecutor = new StaticExecutor(() => ({
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
        isDefault: true,
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
      isDefault: true
    });
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
        userId: "user_1",
        channel: AiChannel.USER_KEY,
        providerName: "openai",
        model: "gpt-4o-mini",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: expect.any(Number),
        success: false,
        errorCode: "UPSTREAM_UNREACHABLE"
      },
      {
        userId: "user_1",
        channel: AiChannel.ASTRBOT,
        providerName: "default",
        model: null,
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        latencyMs: expect.any(Number),
        success: true,
        errorCode: null
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
        isDefault: true,
        isEnabled: true
      })
      .expect(201);

    expect(response.body).toMatchObject({
      channel: AiChannel.ASTRBOT,
      providerName: "",
      configId: "default",
      configName: null
    });
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
});
