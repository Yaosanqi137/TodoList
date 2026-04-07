import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Globe2, KeyRound, LoaderCircle, PlugZap, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listAiBindings,
  testAiBinding,
  upsertAiBinding,
  type WebAiBindingSummary,
  type WebAiBindingsResponse,
  type WebAiChannel
} from "@/services/ai-api";
import type { WebSession } from "@/services/session-storage";
import {
  buildAiBindingPayload,
  createAiBindingFormState,
  type AiBindingFormState
} from "@/components/ai/ai-shared";

type SettingsPageProps = {
  session: WebSession;
};

type SettingsTab = "ai" | "general";

type NoticeState = {
  tone: "success" | "error";
  message: string;
};

type ChannelNoticeState = NoticeState & {
  detail?: string;
};

const TODOLIST_VERSION = "0.1.0";

function AiConfigCard({
  channel,
  title,
  description,
  icon: Icon,
  formState,
  onChange,
  onSave,
  saving,
  binding,
  notice
}: {
  channel: Exclude<WebAiChannel, "PUBLIC_POOL">;
  title: string;
  description: string;
  icon: typeof KeyRound;
  formState: AiBindingFormState;
  onChange: React.Dispatch<React.SetStateAction<AiBindingFormState>>;
  onSave: () => Promise<void>;
  saving: boolean;
  binding: WebAiBindingSummary | null;
  notice: ChannelNoticeState | null;
}) {
  return (
    <section className="rounded-[2rem] border border-border/70 bg-card/92 p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Icon className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            formState.isEnabled
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border bg-background text-muted-foreground"
          )}
        >
          {formState.isEnabled ? "已启用" : "已停用"}
        </span>
      </div>

      {notice ? (
        <div
          className={cn(
            "mt-4 rounded-2xl border px-3 py-3 text-sm",
            notice.tone === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          )}
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div>{notice.message}</div>
              {notice.detail ? (
                <div className="mt-1 text-xs leading-6 opacity-80">{notice.detail}</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">服务商标识</span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
            value={formState.providerName}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                providerName: event.target.value
              }))
            }
            placeholder={channel === "USER_KEY" ? "如 openai / deepseek / dashscope" : "可选"}
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">模型</span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
            value={formState.model}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                model: event.target.value
              }))
            }
            placeholder={channel === "USER_KEY" ? "如 gpt-4o-mini" : "可选"}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {channel === "USER_KEY" ? "接口地址" : "AstrBot 地址"}
          </span>
          <input
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40"
            value={formState.endpoint}
            onChange={(event) =>
              onChange((current) => ({
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
                  onChange((current) => ({
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
                  onChange((current) => ({
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
              onChange((current) => ({
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
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={formState.isEnabled}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              isEnabled: event.target.checked
            }))
          }
        />
        <span>保存后立即启用该渠道</span>
      </label>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-6 text-muted-foreground">
          {channel === "USER_KEY"
            ? "该配置按用户单独保存，适合接入你自己的服务商密钥。"
            : "该配置按用户单独保存，适合直接复用 AstrBot 中已有的模型能力。"}
          <br />
          测试基于你当前表单中的输入；如果测试失败，当前已保存并生效的旧配置不会被覆盖。
        </p>

        <Button type="button" onClick={() => void onSave()} disabled={saving}>
          {saving ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              处理中
            </>
          ) : formState.isEnabled ? (
            "测试并保存"
          ) : (
            "保存草稿"
          )}
        </Button>
      </div>
    </section>
  );
}

export function SettingsPage({ session }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");
  const [bindingsResponse, setBindingsResponse] = useState<WebAiBindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [savingChannel, setSavingChannel] = useState<WebAiChannel | null>(null);
  const [channelNotices, setChannelNotices] = useState<
    Partial<Record<Exclude<WebAiChannel, "PUBLIC_POOL">, ChannelNoticeState>>
  >({});
  const [userKeyForm, setUserKeyForm] = useState<AiBindingFormState>(() =>
    createAiBindingFormState()
  );
  const [astrbotForm, setAstrbotForm] = useState<AiBindingFormState>(() =>
    createAiBindingFormState()
  );

  const bindingMap = useMemo(() => {
    const map = new Map<WebAiChannel, WebAiBindingSummary>();
    for (const binding of bindingsResponse?.bindings ?? []) {
      map.set(binding.channel, binding);
    }
    return map;
  }, [bindingsResponse]);

  const loadBindings = useCallback(async (): Promise<void> => {
    setRefreshing(true);

    try {
      const response = await listAiBindings(session);
      setBindingsResponse(response);
      setUserKeyForm(
        createAiBindingFormState(response.bindings.find((item) => item.channel === "USER_KEY"))
      );
      setAstrbotForm(
        createAiBindingFormState(response.bindings.find((item) => item.channel === "ASTRBOT"))
      );
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "AI 配置加载失败"
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  async function handleSaveChannel(channel: Exclude<WebAiChannel, "PUBLIC_POOL">): Promise<void> {
    const formState = channel === "USER_KEY" ? userKeyForm : astrbotForm;
    const binding = bindingMap.get(channel) ?? null;
    const payload = buildAiBindingPayload(channel, formState, binding);

    try {
      setSavingChannel(channel);
      setChannelNotices((current) => ({
        ...current,
        [channel]: undefined
      }));
      if (payload.isEnabled) {
        const testResult = await testAiBinding(session, payload);
        if (!testResult.success) {
          setChannelNotices((current) => ({
            ...current,
            [channel]: {
              tone: "error",
              message: `连通性测试未通过：${testResult.message}`,
              detail: binding
                ? "测试的是你当前编辑中的草稿配置。由于未保存，系统仍会继续使用上一份已保存配置，所以聊天可能依然正常。"
                : "当前还没有已保存配置。请先修正表单中的地址、模型或密钥后再测试。"
            }
          }));
          return;
        }
      }

      await upsertAiBinding(session, payload);
      setChannelNotices((current) => ({
        ...current,
        [channel]: {
          tone: "success",
          message:
            channel === "USER_KEY"
              ? payload.isEnabled
                ? "自备厂商连通性测试通过，配置已保存。"
                : "自备厂商配置草稿已保存。"
              : payload.isEnabled
                ? "AstrBot 连通性测试通过，配置已保存。"
                : "AstrBot 配置草稿已保存。",
          detail: payload.isEnabled
            ? "之后 AI 助手会使用这份刚保存的配置。"
            : "当前只是保存草稿，未启用时不会参与实际聊天。"
        }
      }));
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
      await loadBindings();
    } catch (error) {
      setChannelNotices((current) => ({
        ...current,
        [channel]: {
          tone: "error",
          message: error instanceof Error ? error.message : "AI 配置保存失败"
        }
      }));
    } finally {
      setSavingChannel(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-[2rem] border border-border/70 bg-card/92 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Settings2 className="size-4" />
              系统设置
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              统一管理 AI 配置与系统选项
            </h1>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              你可以在这里维护自备厂商、AstrBot、公共 AI 的使用状态，后续也会扩展提醒偏好、
              界面设置与存储信息等系统能力。
            </p>
            <div className="mt-3 inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              TodoList v{TODOLIST_VERSION}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => void loadBindings()}
            disabled={refreshing}
          >
            {refreshing ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                刷新中
              </>
            ) : (
              "刷新配置"
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant={activeTab === "ai" ? "default" : "outline"}
          onClick={() => setActiveTab("ai")}
        >
          AI 配置
        </Button>
        <Button
          type="button"
          variant={activeTab === "general" ? "default" : "outline"}
          onClick={() => setActiveTab("general")}
        >
          其他设置
        </Button>
      </div>

      {notice ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm",
            notice.tone === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          )}
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{notice.message}</span>
        </div>
      ) : null}

      {activeTab === "ai" ? (
        loading ? (
          <div className="rounded-[2rem] border border-border/70 bg-card/92 p-6 text-sm text-muted-foreground shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
            正在加载 AI 配置...
          </div>
        ) : (
          <div className="space-y-4">
            <AiConfigCard
              channel="USER_KEY"
              title="自备厂商"
              description="当前支持 OpenAI-Compatible 接口。Google 原生协议、阿里云原生协议将单独适配。"
              icon={KeyRound}
              formState={userKeyForm}
              onChange={setUserKeyForm}
              onSave={() => handleSaveChannel("USER_KEY")}
              saving={savingChannel === "USER_KEY"}
              binding={bindingMap.get("USER_KEY") ?? null}
              notice={channelNotices.USER_KEY ?? null}
            />

            <AiConfigCard
              channel="ASTRBOT"
              title="AstrBot"
              description="填写 AstrBot 地址与 API Key 后，即可在 AI 助手页面中使用你的 AstrBot 渠道。"
              icon={PlugZap}
              formState={astrbotForm}
              onChange={setAstrbotForm}
              onSave={() => handleSaveChannel("ASTRBOT")}
              saving={savingChannel === "ASTRBOT"}
              binding={bindingMap.get("ASTRBOT") ?? null}
              notice={channelNotices.ASTRBOT ?? null}
            />

            <section className="rounded-[2rem] border border-border/70 bg-card/92 p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <Globe2 className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                      公共 AI
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      该渠道由管理员统一维护，普通用户仅可查看状态和使用，不可修改。
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    bindingsResponse?.publicPool?.enabled
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-background text-muted-foreground"
                  )}
                >
                  {bindingsResponse?.publicPool?.enabled ? "已开放" : "未开放"}
                </span>
              </div>

              <div className="mt-4 rounded-2xl border border-border/70 bg-background/80 p-4 text-sm leading-7 text-muted-foreground">
                <div>
                  提供商：
                  <span className="ml-2 text-foreground">
                    {bindingsResponse?.publicPool?.providerName || "未设置"}
                  </span>
                </div>
                <div>
                  模型：
                  <span className="ml-2 text-foreground">
                    {bindingsResponse?.publicPool?.model || "未设置"}
                  </span>
                </div>
              </div>
            </section>
          </div>
        )
      ) : (
        <section className="rounded-[2rem] border border-border/70 bg-card/92 p-8 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">其他设置</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            这里后续会接入站点外观、提醒偏好、存储配额展示等系统设置项。当前先把 AI
            配置独立出来，避免继续堆在任务页面。
          </p>
        </section>
      )}
    </section>
  );
}
