import type { WebSession } from "@/services/session-storage";

type TodoShellPageProps = {
  session: WebSession | null;
};

export function TodoShellPage({ session }: TodoShellPageProps) {
  return (
    <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.6)] backdrop-blur">
      <h1 className="text-2xl font-semibold text-foreground">TodoList 工作台</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {session ? `当前登录邮箱：${session.user.email}` : "当前未建立登录会话，请先完成登录。"}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">今日重点</p>
          <p className="mt-2 text-lg font-semibold text-foreground">待接入</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">临近截止</p>
          <p className="mt-2 text-lg font-semibold text-foreground">待接入</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">任务分析</p>
          <p className="mt-2 text-lg font-semibold text-foreground">待接入</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        当前为界面阶段，统计卡片将在任务数据接入后显示真实结果。
      </p>
    </div>
  );
}
