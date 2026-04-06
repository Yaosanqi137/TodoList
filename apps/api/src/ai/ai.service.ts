import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import {
  AiChannel,
  AiProviderBinding,
  AiPublicPoolConfig,
  Prisma
} from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AiProviderRegistryService } from "./ai-provider-registry.service";
import { AiChatDto } from "./dto/ai-chat.dto";
import { UpsertAiProviderBindingDto } from "./dto/upsert-ai-provider-binding.dto";
import { AiResolvedRouteCandidate, AiRouteAttempt, AiRouteFailureError } from "./ai.types";

type AiBindingSummary = {
  id: string;
  channel: AiChannel;
  providerName: string;
  model: string | null;
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

  async upsertBinding(userId: string, dto: UpsertAiProviderBindingDto): Promise<AiBindingSummary> {
    if (dto.channel === AiChannel.PUBLIC_POOL) {
      throw new BadRequestException("公共 AI 通道只能由管理员配置");
    }

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
            providerName: dto.providerName.trim(),
            model: this.normalizeOptionalString(dto.model),
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
        providerName: dto.providerName.trim(),
        model: this.normalizeOptionalString(dto.model),
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

    for (const entry of plan) {
      if (entry.kind === "skip") {
        attempts.push(entry.attempt);
        continue;
      }

      const executor = this.aiProviderRegistryService.getExecutor(entry.candidate.channel);

      try {
        const result = await executor.execute(entry.candidate, {
          userId,
          message: dto.message,
          sessionId: dto.sessionId ?? null
        });

        attempts.push({
          channel: result.channel,
          providerName: result.providerName,
          model: result.model,
          status: "success",
          reasonCode: null,
          reasonMessage: null
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
        const failureAttempt = this.toFailureAttempt(entry.candidate, error);
        attempts.push(failureAttempt);
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
      endpoint: binding.endpoint,
      isDefault: binding.isDefault,
      isEnabled: binding.isEnabled,
      hasApiKey: Boolean(binding.encryptedApiKey),
      maskedApiKey: this.maskSecret(binding.encryptedApiKey),
      updatedAt: binding.updatedAt.toISOString()
    };
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

  private maskSecret(secret: string | null): string | null {
    if (!secret) {
      return null;
    }

    if (secret.length <= 6) {
      return "*".repeat(secret.length);
    }

    return `${secret.slice(0, 4)}***${secret.slice(-2)}`;
  }
}
