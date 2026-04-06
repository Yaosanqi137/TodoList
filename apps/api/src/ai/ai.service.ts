import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
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
  isDefault: boolean;
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
    endpoint: string | null;
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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly maxContextTasks = 6;
  private readonly maxContextContentLength = 80;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiProviderRegistryService: AiProviderRegistryService
  ) {}

  async listBindings(userId: string): Promise<ListAiBindingsResponse> {
    const [bindings, publicPool] = await Promise.all([
      this.prismaService.aiProviderBinding.findMany({
        where: {
          userId
        },
        orderBy: [{ channel: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }]
      }),
      this.prismaService.aiPublicPoolConfig.findFirst({
        orderBy: {
          updatedAt: "desc"
        }
      })
    ]);

    return {
      routeOrder: [AiChannel.USER_KEY, AiChannel.ASTRBOT, AiChannel.PUBLIC_POOL],
      bindings: bindings.map((binding) => this.serializeBinding(binding)),
      publicPool: publicPool
        ? {
            enabled: publicPool.enabled,
            providerName: publicPool.providerName,
            model: publicPool.model,
            endpoint: publicPool.endpoint,
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
      if (dto.isDefault) {
        const where: Prisma.AiProviderBindingWhereInput = {
          userId,
          channel: dto.channel
        };

        if (dto.id) {
          where.id = {
            not: dto.id
          };
        }

        await tx.aiProviderBinding.updateMany({
          where,
          data: {
            isDefault: false
          }
        });
      }

      if (!dto.id) {
        return tx.aiProviderBinding.create({
          data: {
            userId,
            channel: dto.channel,
            providerName: this.normalizeProviderName(dto.providerName),
            model: this.normalizeOptionalString(dto.model),
            configId: this.normalizeOptionalString(dto.configId),
            configName: this.normalizeOptionalString(dto.configName),
            endpoint: this.normalizeOptionalString(dto.endpoint),
            encryptedApiKey: this.normalizeOptionalString(dto.apiKey),
            isDefault: dto.isDefault ?? false,
            isEnabled: dto.isEnabled ?? true
          }
        });
      }

      const existingBinding = await tx.aiProviderBinding.findFirst({
        where: {
          id: dto.id,
          userId
        }
      });

      if (!existingBinding) {
        throw new NotFoundException("AI 通道配置不存在");
      }

      const updateData: Prisma.AiProviderBindingUpdateInput = {
        channel: dto.channel,
        providerName: this.normalizeProviderName(dto.providerName),
        model: this.normalizeOptionalString(dto.model),
        configId: this.normalizeOptionalString(dto.configId),
        configName: this.normalizeOptionalString(dto.configName),
        isDefault: dto.isDefault ?? existingBinding.isDefault,
        isEnabled: dto.isEnabled ?? existingBinding.isEnabled
      };

      if (dto.endpoint !== undefined) {
        updateData.endpoint = this.normalizeOptionalString(dto.endpoint);
      }

      if (dto.apiKey !== undefined) {
        updateData.encryptedApiKey = this.normalizeOptionalString(dto.apiKey);
      }

      return tx.aiProviderBinding.update({
        where: {
          id: dto.id
        },
        data: updateData
      });
    });

    return this.serializeBinding(result);
  }

  async chat(userId: string, dto: AiChatDto): Promise<AiChatResponse> {
    const attempts: AiRouteAttempt[] = [];
    const plan = await this.buildRoutePlan(userId, dto.bindingId ?? null);
    const promptMessage = await this.buildPromptMessage(userId, dto.message);

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
    bindingId: string | null
  ): Promise<AiRoutePlanEntry[]> {
    const plan: AiRoutePlanEntry[] = [];
    const consumedChannels = new Set<AiChannel>();

    if (bindingId) {
      const pinnedBinding = await this.prismaService.aiProviderBinding.findFirst({
        where: {
          id: bindingId,
          userId,
          isEnabled: true
        }
      });

      if (!pinnedBinding) {
        throw new NotFoundException("指定的 AI 通道配置不存在或已禁用");
      }

      plan.push({
        kind: "candidate",
        candidate: this.toBindingCandidate(pinnedBinding)
      });
      consumedChannels.add(pinnedBinding.channel);
    }

    for (const channel of [AiChannel.USER_KEY, AiChannel.ASTRBOT]) {
      if (consumedChannels.has(channel)) {
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
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
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

  private toBindingCandidate(binding: AiProviderBinding): AiResolvedRouteCandidate {
    return {
      channel: binding.channel,
      source: "binding",
      sourceId: binding.id,
      providerName: binding.providerName,
      model: binding.model,
      configId: binding.configId,
      configName: binding.configName,
      endpoint: binding.endpoint,
      apiKey: binding.encryptedApiKey
    };
  }

  private toPublicPoolCandidate(publicPool: AiPublicPoolConfig): AiResolvedRouteCandidate {
    return {
      channel: AiChannel.PUBLIC_POOL,
      source: "public_pool",
      sourceId: publicPool.id,
      providerName: publicPool.providerName ?? "public-pool",
      model: publicPool.model,
      configId: null,
      configName: null,
      endpoint: publicPool.endpoint,
      apiKey: publicPool.encryptedApiKey
    };
  }

  private serializeBinding(binding: AiProviderBinding): AiBindingSummary {
    return {
      id: binding.id,
      channel: binding.channel,
      providerName: binding.providerName,
      model: binding.model,
      configId: binding.configId,
      configName: binding.configName,
      endpoint: binding.endpoint,
      isDefault: binding.isDefault,
      isEnabled: binding.isEnabled,
      hasApiKey: Boolean(binding.encryptedApiKey),
      maskedApiKey: this.maskSecret(binding.encryptedApiKey),
      updatedAt: binding.updatedAt.toISOString()
    };
  }

  private serializeUsageLog(log: AiUsageLog): AiUsageLogSummary {
    return {
      id: log.id,
      channel: log.channel,
      providerName: log.providerName,
      model: log.model,
      promptTokens: log.promptTokens,
      completionTokens: log.completionTokens,
      totalTokens: log.totalTokens,
      latencyMs: log.latencyMs,
      success: log.success,
      errorCode: log.errorCode,
      createdAt: log.createdAt.toISOString()
    };
  }

  private async buildPromptMessage(userId: string, userMessage: string): Promise<string> {
    const taskSummary = await this.buildTaskContextSummary(userId);
    if (!taskSummary) {
      return userMessage;
    }

    return [
      "你是 TodoList 的 AI 助手，请优先结合用户当前未完成任务给出安排建议。",
      "以下是系统整理的未完成任务摘要：",
      taskSummary,
      "如果用户的问题与任务无关，也可以正常回答；如果相关，请优先考虑优先级、截止时间与执行顺序。",
      `用户当前问题：${userMessage}`
    ].join("\n\n");
  }

  private async buildTaskContextSummary(userId: string): Promise<string | null> {
    const tasks = await this.prismaService.task.findMany({
      where: {
        userId,
        status: {
          in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS]
        }
      },
      select: {
        title: true,
        priority: true,
        status: true,
        ddl: true,
        contentText: true,
        updatedAt: true
      },
      take: 20
    });

    if (tasks.length === 0) {
      return null;
    }

    const sortedTasks = [...tasks].sort((left, right) => {
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
      lines.push(`其余 ${omittedCount} 项未完成任务已省略。`);
    }

    return [`共 ${sortedTasks.length} 项未完成任务。`, ...lines].join("\n");
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
          providerName: input.providerName,
          model: input.model,
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
