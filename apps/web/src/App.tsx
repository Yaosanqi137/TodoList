import { useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmailLoginPage } from "@/pages/email-login-page";
import { OAuthCallbackPage } from "@/pages/oauth-callback-page";
import { TodoShellPage } from "@/pages/todo-shell-page";
import { revokeRefreshToken, type EmailLoginResult } from "@/services/auth-api";
import {
  clearSession,
  loadSession,
  saveSession,
  type WebSession
} from "@/services/session-storage";

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
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    if (!session || loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);
      await revokeRefreshToken(session.refreshToken);
    } catch {
      // 登出流程以本地会话清理为最终兜底，避免页面卡在登录态。
    } finally {
      clearSession();
      setSession(null);
      setLoggingOut(false);
      navigate("/login/email", { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#122117]">
      <header className="border-b border-[#d7e2db] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#0a7a5a]" />
            <span className="text-lg font-semibold tracking-tight">TodoList</span>
          </div>
          {session ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#3a5a4a]">{session.user.email}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "退出中..." : "退出登录"}
              </Button>
            </div>
          ) : (
            <span className="text-sm text-[#3a5a4a]">未登录</span>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Routes>
          <Route
            path="/login/email"
            element={
              <EmailLoginPage
                onLoginSuccess={(payload) => {
                  const nextSession = toWebSession(payload);
                  saveSession(nextSession);
                  setSession(nextSession);
                  navigate("/");
                }}
              />
            }
          />
          <Route
            path="/auth/callback/:provider"
            element={
              <OAuthCallbackPage
                onBootstrapSession={(nextSession) => {
                  setSession(nextSession);
                }}
              />
            }
          />
          <Route
            path="/"
            element={
              session ? <TodoShellPage session={session} /> : <Navigate to="/login/email" replace />
            }
          />
          <Route path="*" element={<Navigate to={session ? "/" : "/login/email"} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
