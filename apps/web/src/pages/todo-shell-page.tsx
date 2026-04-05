import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, CircleAlert } from "lucide-react";
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

    void persistDraft();
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

  return (
    <>
      {renderFeedbackBanner()}
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
              {formatStorageSize(quotaSnapshot.quotaBytes)}（{quotaSnapshot.usedPercent.toFixed(1)}
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
                      {task.status} · {task.priority} · 更新于 {formatUpdatedAt(task.updatedAt)}
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
                    onChange={(payload) =>
                      setFormState((previous) => ({
                        ...previous,
                        contentJson: payload.json,
                        contentText: payload.text
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
