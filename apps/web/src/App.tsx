import { useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { EmailLoginPage } from "@/pages/email-login-page";
import { TodoShellPage } from "@/pages/todo-shell-page";
import type { EmailLoginResult } from "@/services/auth-api";

function App() {
  const [session, setSession] = useState<EmailLoginResult | null>(null);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#122117]">
      <header className="border-b border-[#d7e2db] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#0a7a5a]" />
            <span className="text-lg font-semibold tracking-tight">TodoList</span>
          </div>
          <span className="text-sm text-[#3a5a4a]">{session ? session.user.email : "未登录"}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Routes>
          <Route
            path="/login/email"
            element={
              <EmailLoginPage
                onLoginSuccess={(payload) => {
                  setSession(payload);
                  navigate("/");
                }}
              />
            }
          />
          <Route path="/" element={<TodoShellPage session={session} />} />
          <Route path="*" element={<Navigate to="/login/email" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
