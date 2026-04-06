import type { UpsertWebAiBindingInput, WebAiBindingSummary, WebAiChannel } from "@/services/ai-api";

export type AiBindingFormState = {
  providerName: string;
  model: string;
  endpoint: string;
  apiKey: string;
  configId: string;
  configName: string;
  isEnabled: boolean;
};

export const CHANNEL_ORDER: WebAiChannel[] = ["USER_KEY", "ASTRBOT", "PUBLIC_POOL"];

export const CHANNEL_META: Record<
  WebAiChannel,
  {
    title: string;
    description: string;
    accentClassName: string;
  }
> = {
  USER_KEY: {
    title: "自备厂商",
    description: "用户自行接入 OpenAI-Compatible 服务",
    accentClassName: "from-sky-500/15 via-transparent to-sky-500/5"
  },
  ASTRBOT: {
    title: "AstrBot",
    description: "复用你在 AstrBot 中维护的模型配置",
    accentClassName: "from-amber-500/15 via-transparent to-amber-500/5"
  },
  PUBLIC_POOL: {
    title: "公共 AI",
    description: "使用管理员开放的站点公共通道",
    accentClassName: "from-emerald-500/15 via-transparent to-emerald-500/5"
  }
};

export function createAiBindingFormState(binding?: WebAiBindingSummary | null): AiBindingFormState {
  return {
    providerName: binding?.providerName ?? "",
    model: binding?.model ?? "",
    endpoint: binding?.endpoint ?? "",
    apiKey: "",
    configId: binding?.configId ?? "",
    configName: binding?.configName ?? "",
    isEnabled: binding?.isEnabled ?? true
  };
}

export function trimAiOptionalValue(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function buildAiBindingPayload(
  channel: Exclude<WebAiChannel, "PUBLIC_POOL">,
  formState: AiBindingFormState,
  currentBinding: WebAiBindingSummary | null
): UpsertWebAiBindingInput {
  return {
    channel,
    providerName: trimAiOptionalValue(formState.providerName),
    model: trimAiOptionalValue(formState.model),
    endpoint: trimAiOptionalValue(formState.endpoint),
    configId: trimAiOptionalValue(formState.configId),
    configName: trimAiOptionalValue(formState.configName),
    apiKey: trimAiOptionalValue(formState.apiKey) ?? undefined,
    isEnabled: formState.isEnabled ?? currentBinding?.isEnabled ?? true
  };
}
