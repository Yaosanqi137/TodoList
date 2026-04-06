import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  Globe2,
  KeyRound,
  LoaderCircle,
  PlugZap,
  SendHorizontal
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  chatWithAi,
  listAiBindings,
  type WebAiBindingSummary,
  type WebAiBindingsResponse,
  type WebAiChannel,
  WebAiApiError
} from "@/services/ai-api";
import type { WebSession } from "@/services/session-storage";
import { CHANNEL_META, CHANNEL_ORDER } from "@/components/ai/ai-shared";

type AiChatPageProps = {
  session: WebSession;
};

type AiMessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
};

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

export function AiChatPage({ session }: AiChatPageProps) {
  const navigate = useNavigate();
  const [bindingsResponse, setBindingsResponse] = useState<WebAiBindingsResponse | null>(null);
  const [loadingBindings, setLoadingBindings] = useState(true);
  const [refreshingBindings, setRefreshingBindings] = useState(false);
  const [activeChannel, setActiveChannel] = useState<WebAiChannel>("USER_KEY");
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<WebAiChannel, AiMessageRecord[]>
  >(() => createEmptyMessages());
  const [sessionIds, setSessionIds] = useState<Partial<Record<WebAiChannel, string>>>(() =>
    createEmptySessionIds()
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const publicPool = bindingsResponse?.publicPool ?? null;
  const currentMessages = messagesByChannel[activeChannel];

  const loadBindings = useCallback(async (): Promise<void> => {
    setRefreshingBindings(true);
    setLoadError(null);

    try {
      const response = await listAiBindings(session);
      setBindingsResponse(response);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "AI 配置加载失败");
    } finally {
      setLoadingBindings(false);
      setRefreshingBindings(false);
    }
  }, [session]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth"
    });
  }, [activeChannel, currentMessages.length]);

  const sendBlockedReason = useMemo(() => {
    if (activeChannel === "PUBLIC_POOL") {
      if (!publicPool?.enabled) {
        return "管理员尚未开放公共 AI。";
      }

      return null;
    }

    if (!currentBinding) {
      return activeChannel === "USER_KEY"
        ? "你还没有配置自备厂商，请先前往系统设置 > AI 配置。"
        : "你还没有配置 AstrBot，请先前往系统设置 > AI 配置。";
    }

    if (!currentBinding.isEnabled) {
      return "当前渠道已关闭，请先在系统设置 > AI 配置中启用。";
    }

    return null;
  }, [activeChannel, currentBinding, publicPool]);

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
      const firstAttempt = apiError.attempts?.find((item) => item.reasonMessage);
      const content =
        firstAttempt?.reasonMessage && firstAttempt.reasonMessage !== apiError.message
          ? `${apiError.message}\n${firstAttempt.reasonMessage}`
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

  return (
    <section className="space-y-4">
      <div className="rounded-[2rem] border border-border/70 bg-card/92 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Bot className="size-4" />
              AI 助手
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              在独立页面中发起 AI 对话
            </h1>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              聊天页面只负责问答和任务统筹。所有渠道配置统一放在系统设置中的 AI 配置页面。
            </p>
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
              前往 AI 配置
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadBindings()}
              disabled={refreshingBindings}
            >
              {refreshingBindings ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  刷新中
                </>
              ) : (
                "刷新状态"
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-[2rem] border border-border/70 bg-card/92 p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
          <div>
            <div className="text-sm font-semibold text-foreground">选择渠道</div>
            <div className="mt-1 text-xs leading-6 text-muted-foreground">
              前端只会使用你当前明确选中的那一个渠道。
            </div>
          </div>

          <div className="space-y-2">
            {CHANNEL_ORDER.map((channel) => {
              const selected = activeChannel === channel;
              const binding = channel === "PUBLIC_POOL" ? null : (bindingMap.get(channel) ?? null);
              const enabled =
                channel === "PUBLIC_POOL"
                  ? Boolean(publicPool?.enabled)
                  : Boolean(binding?.isEnabled);
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
              const Icon =
                channel === "PUBLIC_POOL" ? Globe2 : channel === "ASTRBOT" ? PlugZap : KeyRound;

              return (
                <button
                  key={channel}
                  type="button"
                  className={cn(
                    "w-full rounded-2xl border bg-gradient-to-br px-3 py-3 text-left transition-all",
                    CHANNEL_META[channel].accentClassName,
                    selected
                      ? "border-primary/45 ring-2 ring-primary/15"
                      : "border-border/70 hover:border-primary/25 hover:bg-muted/35"
                  )}
                  onClick={() => setActiveChannel(channel)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="rounded-xl bg-background/85 p-2 text-primary shadow-sm">
                        <Icon className="size-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {CHANNEL_META[channel].title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {CHANNEL_META[channel].description}
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        enabled
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-border bg-background text-muted-foreground"
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {loadError ? (
            <div className="rounded-2xl border border-destructive/15 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-3 text-xs leading-6 text-muted-foreground">
            <div className="font-medium text-foreground">当前渠道状态</div>
            <div className="mt-1">
              {loadingBindings
                ? "正在加载配置..."
                : activeChannel === "PUBLIC_POOL"
                  ? publicPool?.enabled
                    ? "公共 AI 已开放，可直接发送。"
                    : "公共 AI 未开放。"
                  : currentBinding
                    ? currentBinding.isEnabled
                      ? "已配置并启用。"
                      : "已配置，但当前关闭。"
                    : "尚未配置。"}
            </div>
          </div>
        </aside>

        <div className="flex min-h-[720px] flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/92 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
          <div className="border-b border-border/70 px-5 py-4">
            <div className="text-sm font-semibold text-foreground">
              {CHANNEL_META[activeChannel].title}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              发送消息时会自动附带你当前未完成任务的摘要。
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {currentMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-4 text-sm leading-7 text-muted-foreground">
                <div className="font-medium text-foreground">暂无对话记录。</div>
                <div className="mt-1">
                  你可以输入“帮我根据当前未完成任务安排今天下午的执行顺序”直接开始。
                </div>
              </div>
            ) : (
              currentMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm",
                    message.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : message.role === "assistant"
                        ? "border border-border/70 bg-background text-foreground"
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

          <div className="border-t border-border/70 p-5">
            {sendBlockedReason ? (
              <div className="mb-3 rounded-2xl border border-amber-500/15 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-700 dark:text-amber-300">
                {sendBlockedReason}
              </div>
            ) : null}

            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="输入你的问题，例如：结合我当前待办，帮我排一下今天的优先级。"
              className="min-h-[140px] w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-7 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleAlert className="size-4" />
                <span>当前只会使用你选中的渠道，不会在前端静默切换。</span>
              </div>
              <div className="flex gap-3">
                {sendBlockedReason ? (
                  <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
                    去系统设置
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={
                    sending || draftMessage.trim().length === 0 || sendBlockedReason !== null
                  }
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
      </div>
    </section>
  );
}
