import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Globe2,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  SendHorizontal,
  Settings2,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  chatWithAi,
  listAiBindings,
  upsertAiBinding,
  type UpsertWebAiBindingInput,
  type WebAiBindingSummary,
  type WebAiBindingsResponse,
  type WebAiChannel,
  WebAiApiError
} from "@/services/ai-api";
import type { WebSession } from "@/services/session-storage";

type AiAssistantPanelProps = {
  session: WebSession;
};

type AiBindingFormState = {
  providerName: string;
  model: string;
  endpoint: string;
  apiKey: string;
  configId: string;
  configName: string;
  isEnabled: boolean;
};

type AiMessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
};

type PanelNotice = {
  tone: "success" | "error";
  message: string;
};

const CHANNEL_ORDER: WebAiChannel[] = ["USER_KEY", "ASTRBOT", "PUBLIC_POOL"];

const CHANNEL_META: Record<
  WebAiChannel,
  {
    title: string;
    description: string;
    icon: typeof KeyRound;
    accentClassName: string;
  }
> = {
  USER_KEY: {
    title: "自备厂商",
    description: "用户自己接入厂商接口",
    icon: KeyRound,
    accentClassName: "from-sky-500/15 via-transparent to-sky-500/5"
  },
  ASTRBOT: {
    title: "AstrBot",
    description: "复用 AstrBot 内已接入模型",
    icon: PlugZap,
    accentClassName: "from-amber-500/15 via-transparent to-amber-500/5"
  },
  PUBLIC_POOL: {
    title: "公共 AI",
    description: "使用站点管理员开放的公共通道",
    icon: Globe2,
    accentClassName: "from-emerald-500/15 via-transparent to-emerald-500/5"
  }
};

function createFormState(binding?: WebAiBindingSummary | null): AiBindingFormState {
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

function createEmptyMessages(): Record<WebAiChannel, AiMessageRecord[]> {
  return {
    USER_KEY: [],
    ASTRBOT: [],
    PUBLIC_POOL: []
  };
}

function createEmptySessionIds(): Partial<Record<WebAiChannel, string>> {
  return {};
}

function formatTimeLabel(date = new Date()): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function trimOptionalValue(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function buildBindingPayload(
  channel: Exclude<WebAiChannel, "PUBLIC_POOL">,
  formState: AiBindingFormState,
  currentBinding: WebAiBindingSummary | null
): UpsertWebAiBindingInput {
  return {
    channel,
    providerName: trimOptionalValue(formState.providerName),
    model: trimOptionalValue(formState.model),
    endpoint: trimOptionalValue(formState.endpoint),
    configId: trimOptionalValue(formState.configId),
    configName: trimOptionalValue(formState.configName),
    apiKey: trimOptionalValue(formState.apiKey) ?? undefined,
    isEnabled: formState.isEnabled ?? currentBinding?.isEnabled ?? true
  };
}

function appendMessage(
  records: Record<WebAiChannel, AiMessageRecord[]>,
  channel: WebAiChannel,
  message: AiMessageRecord
): Record<WebAiChannel, AiMessageRecord[]> {
  return {
    ...records,
    [channel]: [...records[channel], message]
  };
}

export function AiAssistantPanel({ session }: AiAssistantPanelProps) {
  const [bindingsResponse, setBindingsResponse] = useState<WebAiBindingsResponse | null>(null);
  const [loadingBindings, setLoadingBindings] = useState(true);
  const [refreshingBindings, setRefreshingBindings] = useState(false);
  const [activeChannel, setActiveChannel] = useState<WebAiChannel>("USER_KEY");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [userKeyForm, setUserKeyForm] = useState<AiBindingFormState>(() => createFormState());
  const [astrbotForm, setAstrbotForm] = useState<AiBindingFormState>(() => createFormState());
  const [savingChannel, setSavingChannel] = useState<WebAiChannel | null>(null);
  const [panelNotice, setPanelNotice] = useState<PanelNotice | null>(null);
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<WebAiChannel, AiMessageRecord[]>
  >(() => createEmptyMessages());
  const [sessionIds, setSessionIds] = useState<Partial<Record<WebAiChannel, string>>>(() =>
    createEmptySessionIds()
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const bindingMap = useMemo(() => {
    const map = new Map<WebAiChannel, WebAiBindingSummary>();
    for (const binding of bindingsResponse?.bindings ?? []) {
      map.set(binding.channel, binding);
    }
    return map;
  }, [bindingsResponse]);

  const currentBinding =
    activeChannel === "PUBLIC_POOL" ? null : (bindingMap.get(activeChannel) ?? null);
  const currentMessages = messagesByChannel[activeChannel];
  const publicPool = bindingsResponse?.publicPool ?? null;

  const loadBindings = useCallback(
    async (mode: "initial" | "refresh" = "refresh"): Promise<void> => {
      if (mode === "initial") {
        setLoadingBindings(true);
      } else {
        setRefreshingBindings(true);
      }

      try {
        const response = await listAiBindings(session);
        setBindingsResponse(response);
        setUserKeyForm(
          createFormState(response.bindings.find((item) => item.channel === "USER_KEY"))
        );
        setAstrbotForm(
          createFormState(response.bindings.find((item) => item.channel === "ASTRBOT"))
        );
      } catch (error) {
        setPanelNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "AI ??????"
        });
      } finally {
        setLoadingBindings(false);
        setRefreshingBindings(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void loadBindings("initial");
  }, [loadBindings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth"
    });
  }, [activeChannel, currentMessages.length]);

  useEffect(() => {
    if (!panelNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPanelNotice(null);
    }, 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [panelNotice]);

  const sendBlockedReason = useMemo(() => {
    if (activeChannel === "PUBLIC_POOL") {
      if (!publicPool?.enabled) {
        return "管理员尚未开放公共 AI。";
      }

      return null;
    }

    if (!currentBinding) {
      return activeChannel === "USER_KEY" ? "请先保存自备厂商配置。" : "请先保存 AstrBot 配置。";
    }

    if (!currentBinding.isEnabled) {
      return "当前渠道已关闭，请先启用后再发起对话。";
    }

    return null;
  }, [activeChannel, currentBinding, publicPool]);

  const channelStatusText = useMemo(() => {
    if (activeChannel === "PUBLIC_POOL") {
      return publicPool?.enabled ? "管理员已开放" : "当前不可用";
    }

    if (!currentBinding) {
      return "尚未配置";
    }

    return currentBinding.isEnabled ? "已配置并启用" : "已配置但停用";
  }, [activeChannel, currentBinding, publicPool]);

  async function handleSaveChannel(channel: Exclude<WebAiChannel, "PUBLIC_POOL">): Promise<void> {
    const formState = channel === "USER_KEY" ? userKeyForm : astrbotForm;
    const binding = bindingMap.get(channel) ?? null;

    try {
      setSavingChannel(channel);
      await upsertAiBinding(session, buildBindingPayload(channel, formState, binding));
      setPanelNotice({
        tone: "success",
        message: channel === "USER_KEY" ? "自备厂商配置已保存。" : "AstrBot 配置已保存。"
      });
      if (channel === "USER_KEY") {
        setUserKeyForm((current) => ({
          ...current,
          apiKey: ""
        }));
      } else {
        setAstrbotForm((current) => ({
          ...current,
          apiKey: ""
        }));
      }
      await loadBindings("refresh");
    } catch (error) {
      setPanelNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "AI 配置保存失败"
      });
    } finally {
      setSavingChannel(null);
    }
  }

  async function handleSendMessage(): Promise<void> {
    const message = draftMessage.trim();
    if (!message || sendBlockedReason || sending) {
      return;
    }

    const channel = activeChannel;
    setSending(true);
    setDraftMessage("");
    setMessagesByChannel((current) =>
      appendMessage(current, channel, {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        meta: formatTimeLabel()
      })
    );

    try {
      const response = await chatWithAi(session, {
        channel,
        message,
        sessionId: sessionIds[channel]
      });

      setSessionIds((current) => ({
        ...current,
        [channel]: response.sessionId ?? current[channel]
      }));
      setMessagesByChannel((current) =>
        appendMessage(current, channel, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.content,
          meta: `${CHANNEL_META[response.channel].title} · ${response.providerName}${response.model ? ` · ${response.model}` : ""}`
        })
      );
    } catch (error) {
      const apiError =
        error instanceof WebAiApiError
          ? error
          : new WebAiApiError(error instanceof Error ? error.message : "AI 请求失败");
      const firstFailedAttempt = apiError.attempts?.find((item) => item.reasonMessage);
      const content =
        firstFailedAttempt?.reasonMessage && firstFailedAttempt.reasonMessage !== apiError.message
          ? `${apiError.message}\n${firstFailedAttempt.reasonMessage}`
          : apiError.message;

      setMessagesByChannel((current) =>
        appendMessage(current, channel, {
          id: crypto.randomUUID(),
          role: "system",
          content,
          meta: "调用失败"
        })
      );
    } finally {
      setSending(false);
    }
  }

  function renderChannelButton(channel: WebAiChannel) {
    const channelMeta = CHANNEL_META[channel];
    const ChannelIcon = channelMeta.icon;
    const selected = activeChannel === channel;
    const binding = channel === "PUBLIC_POOL" ? null : (bindingMap.get(channel) ?? null);
    const enabled =
      channel === "PUBLIC_POOL" ? Boolean(publicPool?.enabled) : Boolean(binding?.isEnabled);
    const statusLabel =
      channel === "PUBLIC_POOL"
        ? publicPool?.enabled
          ? "可使用"
          : "未开放"
        : binding
          ? enabled
            ? "已启用"
            : "已停用"
          : "未配置";

    return (
      <button
        key={channel}
        type="button"
        className={cn(
          "rounded-2xl border px-3 py-3 text-left transition-all",
          "bg-gradient-to-br shadow-sm",
          channelMeta.accentClassName,
          selected
            ? "border-primary/50 bg-primary/8 ring-2 ring-primary/20"
            : "border-border/70 hover:border-primary/25 hover:bg-muted/40"
        )}
        onClick={() => setActiveChannel(channel)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-background/85 p-2 text-primary shadow-sm">
              <ChannelIcon className="size-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">{channelMeta.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{channelMeta.description}</div>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              enabled
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border bg-background/70 text-muted-foreground"
            )}
          >
            {statusLabel}
          </span>
        </div>
      </button>
    );
  }

  function renderNotice() {
    if (!panelNotice) {
      return null;
    }

    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm",
          panelNotice.tone === "success"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-destructive/20 bg-destructive/10 text-destructive"
        )}
      >
        {panelNotice.tone === "success" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
        )}
        <span>{panelNotice.message}</span>
      </div>
    );
  }

  function renderPrivateConfigForm(channel: Exclude<WebAiChannel, "PUBLIC_POOL">) {
    const formState = channel === "USER_KEY" ? userKeyForm : astrbotForm;
    const setFormState = channel === "USER_KEY" ? setUserKeyForm : setAstrbotForm;
    const binding = bindingMap.get(channel) ?? null;

    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">服务商标识</span>
            <input
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
              value={formState.providerName}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  providerName: event.target.value
                }))
              }
              placeholder={channel === "USER_KEY" ? "如 openai / dashscope / deepseek" : "可选"}
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">模型</span>
            <input
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
              value={formState.model}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  model: event.target.value
                }))
              }
              placeholder={channel === "USER_KEY" ? "如 gpt-4o-mini" : "可选"}
            />
          </label>
        </div>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {channel === "USER_KEY" ? "接口地址" : "AstrBot 地址"}
          </span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
            value={formState.endpoint}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                endpoint: event.target.value
              }))
            }
            placeholder={
              channel === "USER_KEY" ? "如 https://api.openai.com/v1" : "如 http://100.64.0.21:6185"
            }
          />
        </label>

        {channel === "ASTRBOT" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">configId</span>
              <input
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
                value={formState.configId}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    configId: event.target.value
                  }))
                }
                placeholder="如 default"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">configName</span>
              <input
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
                value={formState.configName}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    configName: event.target.value
                  }))
                }
                placeholder="可选"
              />
            </label>
          </div>
        ) : null}

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {channel === "USER_KEY" ? "API Key" : "AstrBot API Key"}
          </span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
            value={formState.apiKey}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                apiKey: event.target.value
              }))
            }
            placeholder={binding?.hasApiKey ? "留空则保持当前密钥不变" : "请输入密钥"}
          />
          {binding?.maskedApiKey ? (
            <div className="text-xs text-muted-foreground">
              当前已保存密钥：{binding.maskedApiKey}
            </div>
          ) : null}
        </label>

        <label className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={formState.isEnabled}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                isEnabled: event.target.checked
              }))
            }
          />
          <span>保存后立即启用该渠道</span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-5 text-muted-foreground">
            {channel === "USER_KEY"
              ? "当前自备厂商通道按用户单独保存，适合个人独享密钥。"
              : "AstrBot 通道按用户单独保存，可直接复用你在 AstrBot 中维护的模型配置。"}
          </p>
          <Button
            type="button"
            className="shrink-0"
            onClick={() => void handleSaveChannel(channel)}
            disabled={savingChannel === channel}
          >
            {savingChannel === channel ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                保存中
              </>
            ) : (
              "保存配置"
            )}
          </Button>
        </div>
      </div>
    );
  }

  function renderPublicPoolCard() {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {publicPool?.providerName || "公共 AI"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {publicPool?.model ? `默认模型：${publicPool.model}` : "管理员尚未设置默认模型"}
              </div>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                publicPool?.enabled
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-background text-muted-foreground"
              )}
            >
              {publicPool?.enabled ? "可用" : "不可用"}
            </span>
          </div>
          <div className="mt-3 text-xs leading-5 text-muted-foreground">
            公共 AI 由管理后台统一维护，普通用户仅可选择使用，不可查看或修改密钥。
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="flex min-h-[720px] flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/92 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)] xl:sticky xl:top-0 xl:max-h-[calc(100vh-7rem)] xl:min-h-0">
      <div className="border-b border-border/70 bg-gradient-to-br from-primary/12 via-background to-background px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Sparkles className="size-4" />
              AI 助手
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              三路通道，按用户独立配置
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              你可以随时切换 AstrBot、自备厂商与公共 AI 进行问答和任务统筹。
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="shrink-0"
            onClick={() => void loadBindings("refresh")}
            disabled={refreshingBindings}
            aria-label="刷新 AI 配置"
          >
            {refreshingBindings ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {renderNotice()}

        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
          {CHANNEL_ORDER.map((channel) => renderChannelButton(channel))}
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-primary/10 p-2 text-primary">
                <Bot className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {CHANNEL_META[activeChannel].title}
                </div>
                <div className="text-xs text-muted-foreground">{channelStatusText}</div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              <Settings2 className="size-4" />
              {settingsOpen ? "收起配置" : "配置渠道"}
            </Button>
          </div>
        </div>

        {settingsOpen ? (
          <div className="rounded-2xl border border-border/70 bg-card/75 p-4">
            {loadingBindings ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在加载 AI 配置...
              </div>
            ) : activeChannel === "PUBLIC_POOL" ? (
              renderPublicPoolCard()
            ) : (
              renderPrivateConfigForm(activeChannel)
            )}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/90">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="text-sm font-semibold text-foreground">对话记录</div>
            <div className="mt-1 text-xs text-muted-foreground">
              当前渠道：{CHANNEL_META[activeChannel].title}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {currentMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-4 text-sm leading-6 text-muted-foreground">
                <div className="font-medium text-foreground">还没有对话记录。</div>
                <div className="mt-1">
                  发送一句话试试看，例如“帮我根据当前未完成任务安排今天下午的执行顺序”。
                </div>
              </div>
            ) : (
              currentMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
                    message.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : message.role === "assistant"
                        ? "border border-border/70 bg-card text-foreground"
                        : "border border-destructive/15 bg-destructive/8 text-foreground"
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  {message.meta ? (
                    <div
                      className={cn(
                        "mt-2 text-[11px]",
                        message.role === "user"
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground"
                      )}
                    >
                      {message.meta}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-border/70 p-4">
            {sendBlockedReason ? (
              <div className="mb-3 rounded-2xl border border-amber-500/15 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {sendBlockedReason}
              </div>
            ) : null}

            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="输入你的问题，例如：结合我当前待办，帮我排一下今天的优先级。"
              className="min-h-[120px] w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {activeChannel === "PUBLIC_POOL" ? (
                  <Globe2 className="size-4" />
                ) : activeChannel === "ASTRBOT" ? (
                  <PlugZap className="size-4" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                <span>发送时将自动附带当前未完成任务摘要。</span>
              </div>

              <Button
                type="button"
                className="shrink-0"
                onClick={() => void handleSendMessage()}
                disabled={sending || draftMessage.trim().length === 0 || sendBlockedReason !== null}
              >
                {sending ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    发送中
                  </>
                ) : (
                  <>
                    <SendHorizontal className="size-4" />
                    发送
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
