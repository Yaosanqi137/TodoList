import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  X
} from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiChatPage } from "@/pages/ai-chat-page";
import { EmailLoginPage } from "@/pages/email-login-page";
import { OAuthCallbackPage } from "@/pages/oauth-callback-page";
import { PlaceholderPage } from "@/pages/placeholder-page";
import { SettingsPage } from "@/pages/settings-page";
import { TodoShellPage } from "@/pages/todo-shell-page";
import { revokeRefreshToken, type EmailLoginResult } from "@/services/auth-api";
import {
  clearSession,
  loadSession,
  saveSession,
  type WebSession
} from "@/services/session-storage";
import {
  applyThemeMode,
  loadThemeMode,
  saveThemeMode,
  type ThemeMode
} from "@/services/theme-storage";

type SidebarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
};

const SIDEBAR_ITEMS: SidebarItem[] = [
  { key: "dashboard", label: "概览面板", icon: LayoutDashboard, path: "/dashboard" },
  { key: "todo", label: "待办事项", icon: ListTodo, path: "/todo" },
  { key: "ai", label: "AI 助手", icon: Sparkles, path: "/ai" },
  { key: "notice", label: "提醒中心", icon: Bell, path: "/notice" },
  { key: "settings", label: "系统设置", icon: Settings, path: "/settings" }
];

const READY_SIDEBAR_KEYS = new Set(["todo", "ai", "settings"]);

function toWebSession(payload: EmailLoginResult): WebSession {
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    user: {
      id: payload.user.id,
      email: payload.user.email
    }
  };
}

function App() {
  const [session, setSession] = useState<WebSession | null>(() => loadSession());
  const [loggingOut, setLoggingOut] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isAuthPage =
    location.pathname === "/login/email" || location.pathname.startsWith("/auth/callback/");

  useEffect(() => {
    applyThemeMode(themeMode);
    saveThemeMode(themeMode);
  }, [themeMode]);

  async function handleLogout(): Promise<void> {
    if (!session || loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);
      await revokeRefreshToken(session.refreshToken);
    } catch {
      // 无论接口成功与否，都要清理本地会话，避免页面卡在登录态。
    } finally {
      clearSession();
      setSession(null);
      setLoggingOut(false);
      setMobileSidebarOpen(false);
      navigate("/login/email", { replace: true });
    }
  }

  function handleToggleTheme(): void {
    setThemeMode((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  function handleLoginSuccess(payload: EmailLoginResult): void {
    const nextSession = toWebSession(payload);
    saveSession(nextSession);
    setSession(nextSession);
    setMobileSidebarOpen(false);
    navigate("/todo", { replace: true });
  }

  function handleBootstrapSession(nextSession: WebSession): void {
    setSession(nextSession);
    setMobileSidebarOpen(false);
  }

  function renderSidebarContent(options: { collapsed: boolean; mobile: boolean }) {
    const { collapsed, mobile } = options;

    return (
      <div className="flex h-full min-h-0 flex-col">
        {mobile ? (
          <div className="flex h-14 shrink-0 items-center justify-end border-b border-border/70 px-3">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="关闭侧边栏"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <nav className="space-y-1">
            {SIDEBAR_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              const isActive =
                location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "group flex w-full items-center rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors",
                    "gap-3 hover:border-primary/25 hover:bg-primary/10",
                    isActive ? "border-primary/25 bg-primary/10" : null
                  )}
                  onClick={() => {
                    navigate(item.path);
                    setMobileSidebarOpen(false);
                  }}
                >
                  <ItemIcon className="size-5 shrink-0 text-primary" />
                  {collapsed ? null : (
                    <>
                      <span className="text-sm whitespace-nowrap text-foreground">
                        {item.label}
                      </span>
                      {READY_SIDEBAR_KEYS.has(item.key) ? null : (
                        <span className="ml-auto whitespace-nowrap rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                          即将上线
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border/70 p-2">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 border-primary/25 px-3 text-primary hover:bg-primary/10"
            onClick={handleToggleTheme}
          >
            {themeMode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {collapsed ? null : (
              <span className="whitespace-nowrap">
                {themeMode === "dark" ? "浅色模式" : "深色模式"}
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 border-primary/25 px-3 text-primary hover:bg-primary/10"
            onClick={handleLogout}
            disabled={!session || loggingOut}
          >
            <LogOut className="size-4" />
            {collapsed ? null : (
              <span className="whitespace-nowrap">{loggingOut ? "退出中..." : "退出登录"}</span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (isAuthPage) {
    return (
      <div className="min-h-dvh bg-background text-foreground md:min-h-screen">
        <main className="flex min-h-dvh items-center justify-center px-4 py-8 md:min-h-screen md:px-6">
          <div className="w-full max-w-md">
            <Routes>
              <Route
                path="/login/email"
                element={<EmailLoginPage onLoginSuccess={handleLoginSuccess} />}
              />
              <Route
                path="/auth/callback/:provider"
                element={<OAuthCallbackPage onBootstrapSession={handleBootstrapSession} />}
              />
              <Route
                path="*"
                element={<Navigate to={session ? "/todo" : "/login/email"} replace />}
              />
            </Routes>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground md:h-screen">
      <header className="relative z-50 shrink-0 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-primary md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="打开侧边栏"
            >
              <Menu className="size-12" />
            </button>
            <img
              src="/favicon.png"
              alt="TodoList"
              className="h-9 w-9 shrink-0 rounded-xl shadow-sm"
            />
            <span className="text-base font-semibold tracking-tight text-foreground">TodoList</span>
          </div>
          <span className="hidden max-w-[280px] truncate text-sm text-muted-foreground md:block">
            {session ? session.user.email : "未登录"}
          </span>
        </div>
      </header>

      {mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/40 backdrop-blur-[2px] md:hidden"
          aria-label="关闭侧边栏遮罩"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed bottom-0 left-0 top-16 z-40 w-72 border-r border-border/80 bg-card/95 backdrop-blur-xl transition-transform duration-300 md:hidden",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {renderSidebarContent({ collapsed: false, mobile: true })}
      </aside>

      <div className="flex h-[calc(100dvh-4rem)] min-h-0 md:h-[calc(100vh-4rem)]">
        <aside
          className={cn(
            "relative hidden h-full border-r border-border/80 bg-card/88 backdrop-blur-xl transition-[width] duration-300 md:flex md:flex-col",
            sidebarCollapsed ? "md:w-14" : "md:w-72"
          )}
        >
          {renderSidebarContent({ collapsed: sidebarCollapsed, mobile: false })}
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className={cn(
              "absolute left-full top-1/2 z-20 -ml-px h-14 w-6 -translate-y-1/2 rounded-none border border-border/80",
              "bg-card/88 text-muted-foreground backdrop-blur-xl transition-colors duration-200 hover:bg-muted/80 hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-0"
            )}
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </Button>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto w-full max-w-6xl">
              <Routes>
                <Route
                  path="/"
                  element={<Navigate to={session ? "/todo" : "/login/email"} replace />}
                />
                <Route
                  path="/dashboard"
                  element={
                    session ? (
                      <PlaceholderPage
                        title="概览面板正在整理"
                        description="这里后续会放任务统计、今日重点、AI 使用概况和提醒概览。当前先把导航和页面结构拆清楚。"
                      />
                    ) : (
                      <Navigate to="/login/email" replace />
                    )
                  }
                />
                <Route
                  path="/todo"
                  element={
                    session ? (
                      <TodoShellPage session={session} />
                    ) : (
                      <Navigate to="/login/email" replace />
                    )
                  }
                />
                <Route
                  path="/ai"
                  element={
                    session ? (
                      <AiChatPage session={session} />
                    ) : (
                      <Navigate to="/login/email" replace />
                    )
                  }
                />
                <Route
                  path="/notice"
                  element={
                    session ? (
                      <PlaceholderPage
                        title="提醒中心即将接入"
                        description="邮件提醒、Web Push 推送、任务到期前通知都会独立收敛到这里，而不是继续堆在任务页里。"
                      />
                    ) : (
                      <Navigate to="/login/email" replace />
                    )
                  }
                />
                <Route
                  path="/settings"
                  element={
                    session ? (
                      <SettingsPage session={session} />
                    ) : (
                      <Navigate to="/login/email" replace />
                    )
                  }
                />
                <Route
                  path="*"
                  element={<Navigate to={session ? "/todo" : "/login/email"} replace />}
                />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
