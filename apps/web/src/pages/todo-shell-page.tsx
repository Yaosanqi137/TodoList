import type { EmailLoginResult } from "@/services/auth-api";

type TodoShellPageProps = {
  session: EmailLoginResult | null;
};

export function TodoShellPage({ session }: TodoShellPageProps) {
  return (
    <div className="rounded-xl border border-[#d7e2db] bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-[#122117]">TodoList 工作台</h1>
      <p className="mt-2 text-sm text-[#3a5a4a]">
        {session
          ? `当前登录用户：${session.user.email}`
          : "当前未建立会话，后续提交会补齐会话恢复和路由守卫。"}
      </p>
    </div>
  );
}
