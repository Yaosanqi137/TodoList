import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger
} from "@nestjs/common";
import {
  AiChannel,
  AiUsageLog,
  AiProviderBinding,
  AiPublicPoolConfig,
  Prisma,
  TaskPriority,
  TaskStatus
} from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DataEncryptionService } from "../security/data-encryption.service";
import { AiRateLimitService } from "./ai-rate-limit.service";
import { AiProviderRegistryService } from "./ai-provider-registry.service";
import { AiChatDto } from "./dto/ai-chat.dto";
import { ListAiUsageLogsQueryDto } from "./dto/list-ai-usage-logs-query.dto";
import { UpsertAiProviderBindingDto } from "./dto/upsert-ai-provider-binding.dto";
import {
  AiResolvedRouteCandidate,
  AiRouteAttempt,
  AiRouteFailureError,
  AiUsageMetrics
} from "./ai.types";

type AiBindingSummary = {
  id: string;
  channel: AiChannel;
  providerName: string;
  model: string | null;
  configId: string | null;
  configName: string | null;
  endpoint: string | null;
  isEnabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  updatedAt: string;
};

type AiRoutePlanEntry =
  | {
      kind: "candidate";
      candidate: AiResolvedRouteCandidate;
    }
  | {
      kind: "skip";
      attempt: AiRouteAttempt;
    };

export type ListAiBindingsResponse = {
  routeOrder: AiChannel[];
  bindings: AiBindingSummary[];
  publicPool: {
    enabled: boolean;
    providerName: string | null;
    model: string | null;
    hasApiKey: boolean;
  } | null;
};

type AiUsageLogSummary = {
  id: string;
  channel: AiChannel;
  providerName: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  success: boolean;
  errorCode: string | null;
  createdAt: string;
};

type AiContextTaskItem = {
  id: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  ddl: Date | null;
  contentText: string | null;
  updatedAt: Date;
};

export type ListAiUsageLogsResponse = {
  items: AiUsageLogSummary[];
  page: number;
  pageSize: number;
  total: number;
};

export type AiChatResponse = {
  channel: AiChannel;
  providerName: string;
  model: string | null;
  content: string;
  sessionId: string | null;
  attempts: AiRouteAttempt[];
};

export type TestAiBindingResponse =
  | {
      success: true;
      channel: AiChannel;
      providerName: string;
      model: string | null;
      contentPreview: string;
    }
  | {
      success: false;
      channel: AiChannel;
      providerName: string;
      model: string | null;
      code: string;
      message: string;
    };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly maxContextTasks = 6;
  private readonly maxContextContentLength = 80;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiProviderRegistryService: AiProviderRegistryService,
    private readonly dataEncryptionService: DataEncryptionService,
    private readonly aiRateLimitService: AiRateLimitService
  ) {}

  async listBindings(userId: string): Promise<ListAiBindingsResponse> {
    const [bindings, publicPool] = await Promise.all([
      this.prismaService.aiProviderBinding.findMany({
        where: {
          userId
        },
        orderBy: [{ updatedAt: "desc" }]
      }),
      this.prismaService.aiPublicPoolConfig.findFirst({
        orderBy: {
          updatedAt: "desc"
        }
      })
    ]);

    const latestBindings = this.pickLatestBindingsByChannel(bindings);

    return {
      routeOrder: [AiChannel.USER_KEY, AiChannel.ASTRBOT, AiChannel.PUBLIC_POOL],
      bindings: latestBindings.map((binding) => this.serializeBinding(binding)),
      publicPool: publicPool
        ? {
            enabled: publicPool.enabled,
            providerName: this.readDecryptedString(publicPool.providerName),
            model: this.readDecryptedString(publicPool.model),
            hasApiKey: Boolean(publicPool.encryptedApiKey)
          }
        : null
    };
  }

  async listUsageLogs(
    userId: string,
    query: ListAiUsageLogsQueryDto
  ): Promise<ListAiUsageLogsResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.AiUsageLogWhereInput = {
      userId
    };

    if (query.channel) {
      where.channel = query.channel;
    }

    if (query.success !== undefined) {
      where.success = query.success;
    }

    const [items, total] = await Promise.all([
      this.prismaService.aiUsageLog.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: pageSize
      }),
      this.prismaService.aiUsageLog.count({
        where
      })
    ]);

    return {
      items: items.map((item) => this.serializeUsageLog(item)),
      page,
      pageSize,
      total
    };
  }

  async upsertBinding(userId: string, dto: UpsertAiProviderBindingDto): Promise<AiBindingSummary> {
    if (dto.channel === AiChannel.PUBLIC_POOL) {
      throw new BadRequestException("公共 AI 通道只能由管理员配置");
    }

    this.validateBindingInput(dto);

    const result = await this.prismaService.$transaction(async (tx) => {
      const existingBinding = await tx.aiProviderBinding.findFirst({
        where: {
          userId,
          channel: dto.channel
        },
        orderBy: {
          updatedAt: "desc"
        }
      });

      if (!existingBinding) {
        return tx.aiProviderBinding.create({
          data: {
            userId,
            channel: dto.channel,
            providerName: this.encryptRequiredString(this.normalizeProviderName(dto.providerName)),
            model: this.encryptOptionalString(dto.model),
            configId: this.encryptOptionalString(dto.configId),
            configName: this.encryptOptionalString(dto.configName),
            endpoint: this.encryptOptionalString(dto.endpoint),
            encryptedApiKey: this.encryptOptionalString(dto.apiKey),
            isEnabled: dto.isEnabled ?? true
          }
        });
      }

      const updateData: Prisma.AiProviderBindingUpdateInput = {
        channel: dto.channel,
        providerName: this.encryptRequiredString(this.normalizeProviderName(dto.providerName)),
        model: this.encryptOptionalString(dto.model),
        configId: this.encryptOptionalString(dto.configId),
        configName: this.encryptOptionalString(dto.configName),
        isEnabled: dto.isEnabled ?? existingBinding.isEnabled
      };

      if (dto.endpoint !== undefined) {
        updateData.endpoint = this.encryptOptionalString(dto.endpoint);
      }

      if (dto.apiKey !== undefined) {
        updateData.encryptedApiKey = this.encryptOptionalString(dto.apiKey);
      }

      return tx.aiProviderBinding.update({
        where: {
          id: existingBinding.id
        },
        data: updateData
      });
    });

    return this.serializeBinding(result);
  }

  async testBinding(
    userId: string,
    dto: UpsertAiProviderBindingDto
  ): Promise<TestAiBindingResponse> {
    if (dto.channel === AiChannel.PUBLIC_POOL) {
      throw new BadRequestException("公共 AI 通道不能由用户自行测试");
    }

    const candidate = await this.buildTestCandidate(userId, dto);
    const executor = this.aiProviderRegistryService.getExecutor(candidate.channel);

    try {
      const result = await executor.execute(candidate, {
        userId,
        message: "请只回复“连接成功”，不要添加其他内容。",
        sessionId: null
      });

      return {
        success: true,
        channel: result.channel,
        providerName: result.providerName,
        model: result.model,
        contentPreview: this.limitPreviewText(result.content)
      };
    } catch (error) {
      if (error instanceof AiRouteFailureError) {
        return {
          success: false,
          channel: error.channel,
          providerName: error.providerName,
          model: candidate.model,
          code: error.code,
          message: error.message
        };
      }

      if (error instanceof Error) {
        return {
          success: false,
          channel: candidate.channel,
          providerName: candidate.providerName,
          model: candidate.model,
          code: "UNKNOWN_ERROR",
          message: error.message
        };
      }

      return {
        success: false,
        channel: candidate.channel,
        providerName: candidate.providerName,
        model: candidate.model,
        code: "UNKNOWN_ERROR",
        message: "未知错误"
      };
    }
  }

  async chat(
    userId: string,
    dto: AiChatDto,
    clientIp: string | null = null
  ): Promise<AiChatResponse> {
    const rateLimitResult = this.aiRateLimitService.consume(userId, clientIp);
    if (!rateLimitResult.allowed) {
      throw new HttpException(
        {
          message: "AI 请求过于频繁，请稍后再试",
          code: "AI_RATE_LIMITED",
          dimension: rateLimitResult.reason === "USER" ? "user" : "ip",
          retryAfterMs: rateLimitResult.retryAfterMs,
          limit: rateLimitResult.limit,
          windowMs: rateLimitResult.windowMs
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const attempts: AiRouteAttempt[] = [];
    const plan = await this.buildRoutePlan(userId, dto.channel ?? null);
    const promptMessage = await this.buildPromptMessage(userId, dto.message, dto.localTasks ?? []);

    for (const entry of plan) {
      if (entry.kind === "skip") {
        attempts.push(entry.attempt);
        continue;
      }

      const executor = this.aiProviderRegistryService.getExecutor(entry.candidate.channel);
      const startedAt = Date.now();

      try {
        const result = await executor.execute(entry.candidate, {
          userId,
          message: promptMessage,
          sessionId: dto.sessionId ?? null
        });
        const latencyMs = Date.now() - startedAt;

        attempts.push({
          channel: result.channel,
          providerName: result.providerName,
          model: result.model,
          status: "success",
          reasonCode: null,
          reasonMessage: null
        });
        await this.recordUsageLog({
          userId,
          channel: result.channel,
          providerName: result.providerName,
          model: result.model,
          usage: result.usage,
          latencyMs,
          success: true,
          errorCode: null
        });

        return {
          channel: result.channel,
          providerName: result.providerName,
          model: result.model,
          content: result.content,
          sessionId: result.sessionId,
          attempts
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const failureAttempt = this.toFailureAttempt(entry.candidate, error);
        attempts.push(failureAttempt);
        await this.recordUsageLog({
          userId,
          channel: failureAttempt.channel,
          providerName: failureAttempt.providerName,
          model: failureAttempt.model,
          usage: null,
          latencyMs,
          success: false,
          errorCode: failureAttempt.reasonCode
        });
        this.logger.warn(
          `AI 通道降级：channel=${failureAttempt.channel} provider=${failureAttempt.providerName ?? "unknown"} code=${failureAttempt.reasonCode ?? "UNKNOWN"} message=${failureAttempt.reasonMessage ?? "unknown"}`
        );
      }
    }

    throw new BadGatewayException({
      message: "当前没有可用的 AI 通道，请稍后重试",
      attempts
    });
  }

  private async buildRoutePlan(
    userId: string,
    selectedChannel: AiChannel | null
  ): Promise<AiRoutePlanEntry[]> {
    const plan: AiRoutePlanEntry[] = [];
    const targetChannels = selectedChannel
      ? [selectedChannel]
      : [AiChannel.USER_KEY, AiChannel.ASTRBOT, AiChannel.PUBLIC_POOL];

    for (const channel of targetChannels) {
      if (channel === AiChannel.PUBLIC_POOL) {
        const publicPool = await this.findEnabledPublicPool();
        if (publicPool) {
          plan.push({
            kind: "candidate",
            candidate: this.toPublicPoolCandidate(publicPool)
          });
        } else {
          plan.push({
            kind: "skip",
            attempt: {
              channel: AiChannel.PUBLIC_POOL,
              providerName: null,
              model: null,
              status: "skipped",
              reasonCode: "PUBLIC_POOL_DISABLED",
              reasonMessage: "公共 AI 通道未开启"
            }
          });
        }
        continue;
      }

      const binding = await this.findPreferredBinding(userId, channel);
      if (binding) {
        plan.push({
          kind: "candidate",
          candidate: this.toBindingCandidate(binding)
        });
        continue;
      }

      plan.push({
        kind: "skip",
        attempt: {
          channel,
          providerName: null,
          model: null,
          status: "skipped",
          reasonCode: "CHANNEL_NOT_CONFIGURED",
          reasonMessage:
            channel === AiChannel.USER_KEY
              ? "当前用户未配置可用的自备 Key 通道"
              : "当前用户未配置可用的 AstrBot 通道"
        }
      });
    }

    return plan;
  }

  private async findPreferredBinding(
    userId: string,
    channel: AiChannel
  ): Promise<AiProviderBinding | null> {
    return this.prismaService.aiProviderBinding.findFirst({
      where: {
        userId,
        channel,
        isEnabled: true
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  private async findEnabledPublicPool(): Promise<AiPublicPoolConfig | null> {
    return this.prismaService.aiPublicPoolConfig.findFirst({
      where: {
        enabled: true
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
  }

  private async buildTestCandidate(
    userId: string,
    dto: UpsertAiProviderBindingDto
  ): Promise<AiResolvedRouteCandidate> {
    const existingBinding = await this.prismaService.aiProviderBinding.findFirst({
      where: {
        userId,
        channel: dto.channel
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    const mergedDto: UpsertAiProviderBindingDto = {
      channel: dto.channel,
      providerName:
        dto.providerName ?? this.readDecryptedString(existingBinding?.providerName ?? null) ?? "",
      model: dto.model ?? this.readDecryptedString(existingBinding?.model ?? null) ?? undefined,
      configId:
        dto.configId ?? this.readDecryptedString(existingBinding?.configId ?? null) ?? undefined,
      configName:
        dto.configName ??
        this.readDecryptedString(existingBinding?.configName ?? null) ??
        undefined,
      endpoint:
        dto.endpoint ?? this.readDecryptedString(existingBinding?.endpoint ?? null) ?? undefined,
      apiKey:
        dto.apiKey ??
        this.readDecryptedString(existingBinding?.encryptedApiKey ?? null) ??
        undefined,
      isEnabled: dto.isEnabled ?? existingBinding?.isEnabled ?? true
    };

    this.validateBindingInput(mergedDto);

    return {
      channel: mergedDto.channel,
      source: existingBinding ? "binding" : "binding",
      sourceId: existingBinding?.id ?? null,
      providerName: this.normalizeProviderName(mergedDto.providerName),
      model: this.normalizeOptionalString(mergedDto.model),
      configId: this.normalizeOptionalString(mergedDto.configId),
      configName: this.normalizeOptionalString(mergedDto.configName),
      endpoint: this.normalizeOptionalString(mergedDto.endpoint),
      apiKey: this.normalizeOptionalString(mergedDto.apiKey)
    };
  }

  private toBindingCandidate(binding: AiProviderBinding): AiResolvedRouteCandidate {
    return {
      channel: binding.channel,
      source: "binding",
      sourceId: binding.id,
      providerName: this.readDecryptedString(binding.providerName) ?? "",
      model: this.readDecryptedString(binding.model),
      configId: this.readDecryptedString(binding.configId),
      configName: this.readDecryptedString(binding.configName),
      endpoint: this.readDecryptedString(binding.endpoint),
      apiKey: this.readDecryptedString(binding.encryptedApiKey)
    };
  }

  private toPublicPoolCandidate(publicPool: AiPublicPoolConfig): AiResolvedRouteCandidate {
    return {
      channel: AiChannel.PUBLIC_POOL,
      source: "public_pool",
      sourceId: publicPool.id,
      providerName: this.readDecryptedString(publicPool.providerName) ?? "public-pool",
      model: this.readDecryptedString(publicPool.model),
      configId: null,
      configName: null,
      endpoint: this.readDecryptedString(publicPool.endpoint),
      apiKey: this.readDecryptedString(publicPool.encryptedApiKey)
    };
  }

  private serializeBinding(binding: AiProviderBinding): AiBindingSummary {
    const decryptedProviderName = this.readDecryptedString(binding.providerName) ?? "";
    const decryptedModel = this.readDecryptedString(binding.model);
    const decryptedConfigId = this.readDecryptedString(binding.configId);
    const decryptedConfigName = this.readDecryptedString(binding.configName);
    const decryptedEndpoint = this.readDecryptedString(binding.endpoint);
    const decryptedApiKey = this.readDecryptedString(binding.encryptedApiKey);

    return {
      id: binding.id,
      channel: binding.channel,
      providerName: decryptedProviderName,
      model: decryptedModel,
      configId: decryptedConfigId,
      configName: decryptedConfigName,
      endpoint: decryptedEndpoint,
      isEnabled: binding.isEnabled,
      hasApiKey: Boolean(binding.encryptedApiKey),
      maskedApiKey: this.maskSecret(decryptedApiKey),
      updatedAt: binding.updatedAt.toISOString()
    };
  }

  private pickLatestBindingsByChannel(bindings: AiProviderBinding[]): AiProviderBinding[] {
    const bindingMap = new Map<AiChannel, AiProviderBinding>();

    for (const binding of bindings) {
      if (!bindingMap.has(binding.channel)) {
        bindingMap.set(binding.channel, binding);
      }
    }

    return [AiChannel.USER_KEY, AiChannel.ASTRBOT]
      .map((channel) => bindingMap.get(channel) ?? null)
      .filter((binding): binding is AiProviderBinding => binding !== null);
  }

  private serializeUsageLog(log: AiUsageLog): AiUsageLogSummary {
    return {
      id: log.id,
      channel: log.channel,
      providerName: this.readDecryptedString(log.providerName),
      model: this.readDecryptedString(log.model),
      promptTokens: log.promptTokens,
      completionTokens: log.completionTokens,
      totalTokens: log.totalTokens,
      latencyMs: log.latencyMs,
      success: log.success,
      errorCode: log.errorCode,
      createdAt: log.createdAt.toISOString()
    };
  }

  private async buildPromptMessage(
    userId: string,
    userMessage: string,
    localTasks: NonNullable<AiChatDto["localTasks"]>
  ): Promise<string> {
    const taskSummary = await this.buildTaskContextSummary(userId, localTasks);
    if (!taskSummary) {
      return userMessage;
    }

    return [
      "你是 TodoList 的 AI 助手，需要结合用户当前待办提供任务统筹建议。",
      "以下是系统整理的未完成任务摘要：",
      taskSummary,
      "请优先根据这些任务的紧急度、截止时间和执行顺序回答，并给出明确可执行的建议。",
      `用户当前问题：${userMessage}`
    ].join("\n\n");
  }

  private async buildTaskContextSummary(
    userId: string,
    localTasks: NonNullable<AiChatDto["localTasks"]>
  ): Promise<string | null> {
    const tasks = await this.prismaService.task.findMany({
      where: {
        userId,
        status: {
          in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS]
        }
      },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        ddl: true,
        contentText: true,
        updatedAt: true
      },
      take: 20
    });

    const sortedTasks = this.sortContextTasks(this.mergeContextTasks(tasks, localTasks));
    if (sortedTasks.length === 0) {
      return null;
    }

    const visibleTasks = sortedTasks.slice(0, this.maxContextTasks);
    const lines = visibleTasks.map((task, index) => {
      const parts = [
        `${index + 1}. ${task.title}`,
        `优先级：${this.getPriorityLabel(task.priority)}`,
        `状态：${this.getStatusLabel(task.status)}`,
        `DDL：${task.ddl ? task.ddl.toISOString() : "未设置"}`
      ];

      const contentSnippet = this.getContentSnippet(task.contentText);
      if (contentSnippet) {
        parts.push(`内容摘要：${contentSnippet}`);
      }

      return parts.join(" | ");
    });

    const omittedCount = sortedTasks.length - visibleTasks.length;
    if (omittedCount > 0) {
      lines.push(`另有 ${omittedCount} 条任务已省略。`);
    }

    return [`共 ${sortedTasks.length} 条未完成任务。`, ...lines].join("\n");
  }

  private mergeContextTasks(
    databaseTasks: Array<{
      id: string;
      title: string;
      priority: TaskPriority;
      status: TaskStatus;
      ddl: Date | null;
      contentText: string | null;
      updatedAt: Date;
    }>,
    localTasks: NonNullable<AiChatDto["localTasks"]>
  ): AiContextTaskItem[] {
    const taskMap = new Map<string, AiContextTaskItem>();

    for (const task of databaseTasks) {
      taskMap.set(task.id, {
        id: task.id,
        title: this.readDecryptedString(task.title) ?? "未命名任务",
        priority: task.priority,
        status: task.status,
        ddl: task.ddl,
        contentText: this.readDecryptedString(task.contentText),
        updatedAt: task.updatedAt
      });
    }

    for (const task of localTasks) {
      if (task.status !== TaskStatus.TODO && task.status !== TaskStatus.IN_PROGRESS) {
        continue;
      }

      const currentTask = taskMap.get(task.id);
      const nextTask: AiContextTaskItem = {
        id: task.id,
        title: task.title.trim().length > 0 ? task.title.trim() : "未命名任务",
        priority: task.priority,
        status: task.status,
        ddl: typeof task.ddlAt === "number" ? new Date(task.ddlAt) : null,
        contentText:
          typeof task.contentText === "string" && task.contentText.trim().length > 0
            ? task.contentText
            : null,
        updatedAt: new Date(task.updatedAt)
      };

      if (!currentTask || nextTask.updatedAt.getTime() >= currentTask.updatedAt.getTime()) {
        taskMap.set(task.id, nextTask);
      }
    }

    return [...taskMap.values()].filter(
      (task) => task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS
    );
  }

  private sortContextTasks(tasks: AiContextTaskItem[]): AiContextTaskItem[] {
    return [...tasks].sort((left, right) => {
      const priorityDiff =
        this.getPriorityWeight(right.priority) - this.getPriorityWeight(left.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const leftDdl = left.ddl?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDdl = right.ddl?.getTime() ?? Number.POSITIVE_INFINITY;
      if (leftDdl !== rightDdl) {
        return leftDdl - rightDdl;
      }

      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
  }

  private toFailureAttempt(candidate: AiResolvedRouteCandidate, error: unknown): AiRouteAttempt {
    if (error instanceof AiRouteFailureError) {
      return {
        channel: error.channel,
        providerName: error.providerName,
        model: candidate.model,
        status: "failed",
        reasonCode: error.code,
        reasonMessage: error.message
      };
    }

    if (error instanceof Error) {
      return {
        channel: candidate.channel,
        providerName: candidate.providerName,
        model: candidate.model,
        status: "failed",
        reasonCode: "UNKNOWN_ERROR",
        reasonMessage: error.message
      };
    }

    return {
      channel: candidate.channel,
      providerName: candidate.providerName,
      model: candidate.model,
      status: "failed",
      reasonCode: "UNKNOWN_ERROR",
      reasonMessage: "未知错误"
    };
  }

  private normalizeOptionalString(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  }

  private normalizeProviderName(value: string | undefined): string {
    return this.normalizeOptionalString(value) ?? "";
  }

  private encryptOptionalString(value: string | undefined): string | null | undefined {
    const normalizedValue = this.normalizeOptionalString(value);
    return this.dataEncryptionService.encryptString(normalizedValue);
  }

  private encryptRequiredString(value: string): string {
    const encryptedValue = this.dataEncryptionService.encryptString(value);
    if (!encryptedValue) {
      throw new BadRequestException("敏感配置加密失败");
    }

    return encryptedValue;
  }

  private readDecryptedString(value: string | null): string | null {
    const decryptedValue = this.dataEncryptionService.decryptString(value);
    return typeof decryptedValue === "string" ? decryptedValue : null;
  }

  private validateBindingInput(dto: UpsertAiProviderBindingDto): void {
    const providerName = this.normalizeOptionalString(dto.providerName);
    const configId = this.normalizeOptionalString(dto.configId);
    const configName = this.normalizeOptionalString(dto.configName);

    if (dto.channel === AiChannel.ASTRBOT) {
      if (!providerName && !configId && !configName) {
        throw new BadRequestException(
          "AstrBot 通道至少需要 providerName、configId、configName 三者之一"
        );
      }
      return;
    }

    if (!providerName) {
      throw new BadRequestException("当前通道必须提供 providerName");
    }
  }

  private maskSecret(secret: string | null): string | null {
    if (!secret) {
      return null;
    }

    if (secret.length <= 6) {
      return "*".repeat(secret.length);
    }

    return `${secret.slice(0, 4)}***${secret.slice(-2)}`;
  }

  private limitPreviewText(content: string): string {
    const normalizedContent = content.replace(/\s+/g, " ").trim();
    if (normalizedContent.length <= 60) {
      return normalizedContent;
    }

    return `${normalizedContent.slice(0, 60)}...`;
  }

  private getPriorityWeight(priority: TaskPriority): number {
    switch (priority) {
      case TaskPriority.URGENT:
        return 4;
      case TaskPriority.HIGH:
        return 3;
      case TaskPriority.MEDIUM:
        return 2;
      case TaskPriority.LOW:
        return 1;
      default:
        return 0;
    }
  }

  private getPriorityLabel(priority: TaskPriority): string {
    switch (priority) {
      case TaskPriority.URGENT:
        return "紧急";
      case TaskPriority.HIGH:
        return "高";
      case TaskPriority.MEDIUM:
        return "中";
      case TaskPriority.LOW:
        return "低";
      default:
        return String(priority);
    }
  }

  private getStatusLabel(status: TaskStatus): string {
    switch (status) {
      case TaskStatus.TODO:
        return "待开始";
      case TaskStatus.IN_PROGRESS:
        return "进行中";
      case TaskStatus.DONE:
        return "已完成";
      case TaskStatus.ARCHIVED:
        return "已归档";
      default:
        return String(status);
    }
  }

  private getContentSnippet(contentText: string | null): string | null {
    if (!contentText) {
      return null;
    }

    const normalizedContent = contentText.replace(/\s+/g, " ").trim();
    if (normalizedContent.length === 0) {
      return null;
    }

    if (normalizedContent.length <= this.maxContextContentLength) {
      return normalizedContent;
    }

    return `${normalizedContent.slice(0, this.maxContextContentLength)}...`;
  }

  private async recordUsageLog(input: {
    userId: string;
    channel: AiChannel;
    providerName: string | null;
    model: string | null;
    usage: AiUsageMetrics | null;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
  }): Promise<void> {
    try {
      await this.prismaService.aiUsageLog.create({
        data: {
          userId: input.userId,
          channel: input.channel,
          providerName:
            input.providerName === null
              ? null
              : this.dataEncryptionService.encryptString(input.providerName),
          model:
            input.model === null ? null : this.dataEncryptionService.encryptString(input.model),
          promptTokens: input.usage?.promptTokens ?? 0,
          completionTokens: input.usage?.completionTokens ?? 0,
          totalTokens: input.usage?.totalTokens ?? 0,
          latencyMs: input.latencyMs,
          success: input.success,
          errorCode: input.errorCode
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      this.logger.warn(`写入 AI 使用日志失败：${message}`);
    }
  }
}
