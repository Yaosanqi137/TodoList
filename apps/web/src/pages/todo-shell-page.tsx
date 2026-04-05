import type { WebSession } from "@/services/session-storage";

type TodoShellPageProps = {
  session: WebSession | null;
};

export function TodoShellPage({ session }: TodoShellPageProps) {
  return (
    <div className="rounded-xl border border-[#d7e2db] bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-[#122117]">TodoList 工作台</h1>
      <p className="mt-2 text-sm text-[#3a5a4a]">
        {session ? `当前登录邮箱：${session.user.email}` : "当前未建立登录会话，请先完成登录。"}
      </p>
    </div>
  );
}
