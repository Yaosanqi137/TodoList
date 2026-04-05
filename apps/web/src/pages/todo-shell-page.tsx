import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  CircleAlert,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  ServerCrash
} from "lucide-react";
import { useSyncEngine, type SyncEngineStatus } from "@/hooks/use-sync-engine";
import { TaskRichEditor } from "@/components/task-rich-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  LocalTaskDraftRecord,
  LocalTaskPriority,
  LocalTaskRecord,
  LocalTaskStatus
} from "@/services/local-db";
import {
  deleteLocalTaskDraft,
  getLocalTaskDraft,
  saveLocalTaskDraft
} from "@/services/local-task-draft-repo";
import {
  createLocalTask,
  deleteLocalTask,
  getLocalTaskById,
  listLocalTasksByUser,
  updateLocalTask
} from "@/services/local-task-repo";
import { formatStorageSize, getStorageQuotaSnapshot } from "@/services/storage-quota";
import type { WebSession } from "@/services/session-storage";

type TodoShellPageProps = {
  session: WebSession | null;
};

type TaskFormState = {
  title: string;
  contentJson: string | null;
  contentText: string;
  priority: LocalTaskPriority;
  status: LocalTaskStatus;
  ddlInput: string;
};

type FeedbackNotice = {
  message: string;
  tone: "success" | "error";
};

const DRAFT_PERSIST_DEBOUNCE_MS = 500;

const DEFAULT_FORM_STATE: TaskFormState = {
  title: "",
  contentJson: null,
  contentText: "",
  priority: "MEDIUM",
  status: "TODO",
  ddlInput: ""
};

const PRIORITY_OPTIONS: Array<{ value: LocalTaskPriority; label: string }> = [
  { value: "LOW", label: "低" },
  { value: "MEDIUM", label: "中" },
  { value: "HIGH", label: "高" },
  { value: "URGENT", label: "紧急" }
];

const STATUS_OPTIONS: Array<{ value: LocalTaskStatus; label: string }> = [
  { value: "TODO", label: "待办" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "DONE", label: "已完成" },
  { value: "ARCHIVED", label: "已归档" }
];

const PRIORITY_LABEL_MAP: Record<LocalTaskPriority, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  URGENT: "紧急"
};

const STATUS_LABEL_MAP: Record<LocalTaskStatus, string> = {
  TODO: "待办",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
  ARCHIVED: "已归档"
};

function toDatetimeLocalValue(timestamp: number | null): string {
  if (timestamp === null) {
    return "";
  }

  const date = new Date(timestamp);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - timezoneOffset).toISOString().slice(0, 16);
}

function parseDatetimeLocalValue(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createFormStateFromTask(task: LocalTaskRecord): TaskFormState {
  return {
    title: task.title,
    contentJson: task.contentJson,
    contentText: task.contentText ?? "",
    priority: task.priority,
    status: task.status,
    ddlInput: toDatetimeLocalValue(task.ddlAt)
  };
}

function createFormStateFromDraft(draft: LocalTaskDraftRecord): TaskFormState {
  return {
    title: draft.title,
    contentJson: draft.contentJson,
    contentText: draft.contentText,
    priority: draft.priority,
    status: draft.status,
    ddlInput: draft.ddlInput
  };
}

function serializeFormState(formState: TaskFormState): string {
  return JSON.stringify(formState);
}

function formatSyncTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return "尚未完成同步";
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRetryTime(timestamp: number | null): string {
  if (timestamp === null) {
    return "稍后";
  }

  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getSyncSummary(status: SyncEngineStatus): {
  title: string;
  description: string;
  accentClassName: string;
  icon: typeof RefreshCw;
  iconClassName: string;
} {
  if (status.phase === "offline") {
    return {
      title: "离线工作中",
      description:
        status.pendingCount > 0
          ? `当前离线，已保留 ${status.pendingCount} 条待上传改动。`
          : "当前离线，本地仍可继续编辑，联网后会自动同步。",
      accentClassName: "border-amber-200/80 bg-amber-50/80 text-amber-950",
      icon: CloudOff,
      iconClassName: "text-amber-600"
    };
  }

  if (status.phase === "syncing") {
    return {
      title: "正在同步",
      description: "正在上传本地改动并拉取最新云端增量。",
      accentClassName: "border-primary/20 bg-primary/10 text-foreground",
      icon: LoaderCircle,
      iconClassName: "animate-spin text-primary"
    };
  }

  if (status.phase === "backoff") {
    return {
      title: "同步稍后重试",
      description: `${status.lastError ?? "同步失败"}，系统将在 ${formatRetryTime(
        status.nextRetryAt
      )} 再试一次。`,
      accentClassName: "border-destructive/20 bg-destructive/8 text-foreground",
      icon: ServerCrash,
      iconClassName: "text-destructive"
    };
  }

  if (status.phase === "attention") {
    return {
      title: "需要人工关注",
      description: `有 ${status.blockedCount} 条同步记录已达到重试上限，请检查接口配置或网络环境。`,
      accentClassName: "border-destructive/20 bg-destructive/8 text-foreground",
      icon: CircleAlert,
      iconClassName: "text-destructive"
    };
  }

  if (status.pendingRemoteCount > 0) {
    return {
      title: "云端变更已接收",
      description: `已收到 ${status.pendingRemoteCount} 条云端变更，后续会进入本地合并流程。`,
      accentClassName: "border-sky-200/80 bg-sky-50/80 text-sky-950",
      icon: RefreshCw,
      iconClassName: "text-sky-600"
    };
  }

  return {
    title: "同步状态正常",
    description:
      status.pendingCount > 0
        ? `还有 ${status.pendingCount} 条本地改动待处理。`
        : "本地改动与云端增量传输均处于正常状态。",
    accentClassName: "border-emerald-200/80 bg-emerald-50/80 text-emerald-950",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600"
  };
}

export function TodoShellPage({ session }: TodoShellPageProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [formState, setFormState] = useState<TaskFormState>(DEFAULT_FORM_STATE);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackNotice | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [draftReadyTaskId, setDraftReadyTaskId] = useState<string | null>(null);
  const savedTaskSnapshotRef = useRef(serializeFormState(DEFAULT_FORM_STATE));
  const { status: syncStatus, triggerSync } = useSyncEngine(session);

  const userId = session?.user.id ?? "";

  const tasks = useLiveQuery(async () => {
    if (!userId) {
      return [];
    }

    return listLocalTasksByUser(userId);
  }, [userId]);

  const quotaSnapshot = useLiveQuery(async () => {
    if (!userId) {
      return null;
    }

    return getStorageQuotaSnapshot(userId);
  }, [userId]);

  const selectedTask = useLiveQuery(async () => {
    if (!selectedTaskId) {
      return undefined;
    }

    return getLocalTaskById(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!tasks || tasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId) {
      setSelectedTaskId(tasks[0].id);
      return;
    }

    const exists = tasks.some((task) => task.id === selectedTaskId);
    if (!exists) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      setFormState(DEFAULT_FORM_STATE);
      setDraftReadyTaskId(null);
      savedTaskSnapshotRef.current = serializeFormState(DEFAULT_FORM_STATE);
      return;
    }

    if (!selectedTask) {
      return;
    }

    let cancelled = false;
    const currentTask = selectedTask;

    async function hydrateFormState(): Promise<void> {
      const persistedTaskState = createFormStateFromTask(currentTask);
      const localDraft = await getLocalTaskDraft(currentTask.id);

      if (cancelled) {
        return;
      }

      savedTaskSnapshotRef.current = serializeFormState(persistedTaskState);
      setFormState(localDraft ? createFormStateFromDraft(localDraft) : persistedTaskState);
      setDraftReadyTaskId(currentTask.id);
    }

    void hydrateFormState();

    return () => {
      cancelled = true;
    };
  }, [selectedTask, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId || !selectedTask || draftReadyTaskId !== selectedTaskId || !userId) {
      return;
    }

    const currentSnapshot = serializeFormState(formState);
    const currentTaskId = selectedTaskId;
    const currentUserId = userId;

    async function persistDraft(): Promise<void> {
      if (currentSnapshot === savedTaskSnapshotRef.current) {
        await deleteLocalTaskDraft(currentTaskId);
        return;
      }

      await saveLocalTaskDraft({
        taskId: currentTaskId,
        userId: currentUserId,
        title: formState.title,
        contentJson: formState.contentJson,
        contentText: formState.contentText,
        priority: formState.priority,
        status: formState.status,
        ddlInput: formState.ddlInput
      });
    }

    const timeoutId = window.setTimeout(() => {
      void persistDraft();
    }, DRAFT_PERSIST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftReadyTaskId, formState, selectedTask, selectedTaskId, userId]);

  const showFeedback = useCallback((message: string, tone: FeedbackNotice["tone"]): void => {
    setFeedback({ message, tone });
  }, []);

  useEffect(() => {
    if (!feedback) {
      setFeedbackVisible(false);
      return;
    }

    setFeedbackVisible(false);
    const enterAnimationId = window.requestAnimationFrame(() => {
      setFeedbackVisible(true);
    });

    const visibleDuration = feedback.tone === "success" ? 2200 : 3200;
    const hideTimeoutId = window.setTimeout(() => {
      setFeedbackVisible(false);
    }, visibleDuration);

    const cleanupTimeoutId = window.setTimeout(() => {
      setFeedback((currentFeedback) =>
        currentFeedback?.message === feedback.message ? null : currentFeedback
      );
    }, visibleDuration + 260);

    return () => {
      window.cancelAnimationFrame(enterAnimationId);
      window.clearTimeout(hideTimeoutId);
      window.clearTimeout(cleanupTimeoutId);
    };
  }, [feedback]);

  function renderFeedbackBanner() {
    if (!feedback) {
      return null;
    }

    return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
        <div
          className={cn(
            "flex min-w-[240px] max-w-[520px] items-center gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_50px_-24px_hsl(var(--foreground)/0.35)] backdrop-blur transition-all duration-300 ease-out",
            feedbackVisible ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0",
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50/95 text-emerald-900"
              : "border-destructive/30 bg-background/95 text-foreground"
          )}
        >
          {feedback.tone === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <CircleAlert className="h-5 w-5 shrink-0 text-destructive" />
          )}
          <p className="text-sm font-medium">{feedback.message}</p>
        </div>
      </div>
    );
  }

  const handleCreateTask = useCallback(async (): Promise<void> => {
    if (creating || !userId) {
      return;
    }

    try {
      setCreating(true);
      const createdTask = await createLocalTask({ userId });
      setSelectedTaskId(createdTask.id);
      showFeedback("已创建新任务。", "success");
    } finally {
      setCreating(false);
    }
  }, [creating, showFeedback, userId]);

  const handleSaveTask = useCallback(async (): Promise<void> => {
    if (!selectedTaskId || saving) {
      return;
    }

    try {
      setSaving(true);
      const updatedTask = await updateLocalTask({
        id: selectedTaskId,
        title: formState.title,
        contentText: formState.contentText || null,
        contentJson: formState.contentJson,
        priority: formState.priority,
        status: formState.status,
        ddlAt: parseDatetimeLocalValue(formState.ddlInput)
      });

      if (!updatedTask) {
        showFeedback("任务不存在或已被删除。", "error");
        return;
      }

      savedTaskSnapshotRef.current = serializeFormState(createFormStateFromTask(updatedTask));
      await deleteLocalTaskDraft(selectedTaskId);
      showFeedback("任务已保存。", "success");
    } finally {
      setSaving(false);
    }
  }, [formState, saving, selectedTaskId, showFeedback]);

  const handleDeleteTask = useCallback(async (): Promise<void> => {
    if (!selectedTaskId || deleting) {
      return;
    }

    try {
      setDeleting(true);
      const deleted = await deleteLocalTask(selectedTaskId);
      if (!deleted) {
        showFeedback("任务已不存在。", "error");
        return;
      }

      await deleteLocalTaskDraft(selectedTaskId);
      showFeedback("任务已删除。", "success");
    } finally {
      setDeleting(false);
    }
  }, [deleting, selectedTaskId, showFeedback]);

  const handleEditorChange = useCallback((payload: { json: string | null; text: string }): void => {
    startTransition(() => {
      setFormState((previous) => ({
        ...previous,
        contentJson: payload.json,
        contentText: payload.text
      }));
    });
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";

      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();

      if (!selectedTaskId || saving) {
        return;
      }

      void handleSaveTask();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [handleSaveTask, saving, selectedTaskId]);

  if (!session) {
    return (
      <>
        {renderFeedbackBanner()}
        <div className="rounded-2xl border border-border bg-card/90 p-6 text-sm text-muted-foreground">
          当前未建立登录会话，请先完成登录。
        </div>
      </>
    );
  }

  const taskList = tasks ?? [];
  const syncSummary = getSyncSummary(syncStatus);
  const SyncSummaryIcon = syncSummary.icon;

  return (
    <>
      {renderFeedbackBanner()}
      <div className="space-y-4">
        <section
          className={cn(
            "rounded-[1.75rem] border px-4 py-4 shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.38)] backdrop-blur md:px-5",
            syncSummary.accentClassName
          )}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/70 p-2.5 shadow-sm ring-1 ring-black/5">
                <SyncSummaryIcon className={cn("h-5 w-5", syncSummary.iconClassName)} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{syncSummary.title}</p>
                <p className="text-sm leading-6 text-current/80">{syncSummary.description}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-current/10 bg-white/70 px-3 py-1 text-xs text-current/80">
                待上传 {syncStatus.pendingCount}
              </span>
              <span className="rounded-full border border-current/10 bg-white/70 px-3 py-1 text-xs text-current/80">
                云端待合并 {syncStatus.pendingRemoteCount}
              </span>
              {syncStatus.blockedCount > 0 ? (
                <span className="rounded-full border border-destructive/20 bg-white/70 px-3 py-1 text-xs text-destructive">
                  阻塞 {syncStatus.blockedCount}
                </span>
              ) : null}
              <span className="rounded-full border border-current/10 bg-white/70 px-3 py-1 text-xs text-current/80">
                上次成功 {formatSyncTimestamp(syncStatus.lastSyncedAt)}
              </span>
              <Button
                type="button"
                variant="outline"
                className="border-current/15 bg-white/70 text-current hover:bg-white"
                onClick={triggerSync}
                disabled={!syncStatus.isOnline || syncStatus.phase === "syncing"}
              >
                {syncStatus.phase === "syncing" ? "同步中..." : "立即同步"}
              </Button>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-2xl border border-border bg-card/90 p-4 shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.6)] backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">任务列表</h2>
              <Button
                type="button"
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleCreateTask}
                disabled={creating}
              >
                {creating ? "创建中..." : "新建任务"}
              </Button>
            </div>

            {quotaSnapshot ? (
              <p
                className={cn(
                  "mb-3 text-xs",
                  quotaSnapshot.usedPercent >= 85 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                空间占用（估算）：{formatStorageSize(quotaSnapshot.usedBytes)} /{" "}
                {formatStorageSize(quotaSnapshot.quotaBytes)}（
                {quotaSnapshot.usedPercent.toFixed(1)}
                %）
              </p>
            ) : null}

            {taskList.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                还没有任务，点击右上角“新建任务”。
              </p>
            ) : (
              <div className="space-y-2">
                {taskList.map((task) => {
                  const isActive = task.id === selectedTaskId;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        isActive
                          ? "border-primary/45 bg-primary/10"
                          : "border-border bg-background hover:border-primary/25 hover:bg-primary/5"
                      )}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {STATUS_LABEL_MAP[task.status]} · {PRIORITY_LABEL_MAP[task.priority]} ·
                        更新于 {formatUpdatedAt(task.updatedAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/90 p-4 shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.6)] backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">任务详情</h2>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveTask}
                  disabled={!selectedTaskId || saving}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={handleDeleteTask}
                  disabled={!selectedTaskId || deleting}
                >
                  {deleting ? "删除中..." : "删除"}
                </Button>
              </div>
            </div>

            {!selectedTaskId || !selectedTask ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                请选择一个任务进行编辑。
              </p>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm text-muted-foreground">
                  任务标题
                  <input
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    value={formState.title}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        title: event.target.value
                      }))
                    }
                    placeholder="请输入任务标题"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-muted-foreground">
                    状态
                    <select
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      value={formState.status}
                      onChange={(event) =>
                        setFormState((previous) => ({
                          ...previous,
                          status: event.target.value as LocalTaskStatus
                        }))
                      }
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm text-muted-foreground">
                    优先级
                    <select
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      value={formState.priority}
                      onChange={(event) =>
                        setFormState((previous) => ({
                          ...previous,
                          priority: event.target.value as LocalTaskPriority
                        }))
                      }
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block text-sm text-muted-foreground">
                  截止时间
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    value={formState.ddlInput}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        ddlInput: event.target.value
                      }))
                    }
                  />
                </label>

                <div className="block text-sm text-muted-foreground">
                  <p>任务内容</p>
                  <div className="mt-1">
                    <TaskRichEditor
                      valueJson={formState.contentJson}
                      textFallback={formState.contentText}
                      onChange={handleEditorChange}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
