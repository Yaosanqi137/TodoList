import { Button } from "@/components/ui/button";

function App() {
  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#122117]">
      <header className="border-b border-[#d7e2db] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#0a7a5a]" />
            <span className="text-lg font-semibold tracking-tight">TodoList</span>
          </div>
          <Button className="rounded-md bg-[#0a7a5a] text-white hover:bg-[#0a7a5a]/90">登录</Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <section className="rounded-xl border border-[#d7e2db] bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Web 壳已就绪</h1>
          <p className="mt-2 text-sm text-[#3a5a4a]">
            下一步将接入邮箱验证码登录、OAuth 回调和会话恢复。
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
