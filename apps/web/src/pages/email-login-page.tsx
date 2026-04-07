import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { loginWithEmailCode, sendEmailCode, type EmailLoginResult } from "@/services/auth-api";

type EmailLoginPageProps = {
  onLoginSuccess: (payload: EmailLoginResult) => void;
};

const DEFAULT_API_BASE_URL = "http://localhost:3000";

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!envBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  return envBaseUrl.replace(/\/+$/, "");
}

export function EmailLoginPage({ onLoginSuccess }: EmailLoginPageProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSendCode = useMemo(() => {
    return email.trim().length > 0 && !sendingCode && codeCooldown <= 0;
  }, [codeCooldown, email, sendingCode]);

  const canLogin = useMemo(() => {
    return email.trim().length > 0 && code.trim().length === 6 && !loggingIn;
  }, [code, email, loggingIn]);

  async function handleSendCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSendCode) {
      return;
    }

    try {
      setSendingCode(true);
      setError(null);
      setMessage(null);
      const result = await sendEmailCode(email.trim());
      setMessage(`验证码已发送，有效期 ${result.expiresInSeconds} 秒。`);

      let remain = 60;
      setCodeCooldown(remain);
      const timer = window.setInterval(() => {
        remain -= 1;
        setCodeCooldown(remain);
        if (remain <= 0) {
          window.clearInterval(timer);
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送验证码失败");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canLogin) {
      return;
    }

    try {
      setLoggingIn(true);
      setError(null);
      setMessage(null);
      const result = await loginWithEmailCode(email.trim(), code.trim());
      onLoginSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card/92 p-6 shadow-[0_24px_60px_-36px_hsl(var(--primary)/0.65)] backdrop-blur">
      <div className="mb-4 flex items-center gap-3">
        <img src="/favicon.png" alt="TodoList" className="h-10 w-10 rounded-xl shadow-sm" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">邮箱验证码登录</h1>
        </div>
      </div>

      <form className="mt-6 space-y-3" onSubmit={handleSendCode}>
        <label className="block text-sm font-medium text-secondary-foreground" htmlFor="email">
          邮箱
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="email"
            type="email"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-ring/25"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            type="submit"
            disabled={!canSendCode}
            className="shrink-0 bg-primary px-4 text-primary-foreground hover:bg-primary/90"
          >
            {sendingCode ? "发送中..." : codeCooldown > 0 ? `${codeCooldown}s` : "发送验证码"}
          </Button>
        </div>
      </form>

      <form className="mt-4 space-y-3" onSubmit={handleLogin}>
        <label className="block text-sm font-medium text-secondary-foreground" htmlFor="code">
          验证码
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-ring/25"
          placeholder="6位数字验证码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button
          type="submit"
          disabled={!canLogin}
          className="w-full bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95"
        >
          {loggingIn ? "登录中..." : "立即登录"}
        </Button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-2">
        <a href={`${resolveApiBaseUrl()}/auth/oauth/github`}>
          <Button
            type="button"
            variant="outline"
            className="w-full border-border bg-card text-foreground"
          >
            使用 GitHub 登录
          </Button>
        </a>
        <a href={`${resolveApiBaseUrl()}/auth/oauth/qq`}>
          <Button
            type="button"
            variant="outline"
            className="w-full border-border bg-card text-foreground"
          >
            使用 QQ 登录
          </Button>
        </a>
        <a href={`${resolveApiBaseUrl()}/auth/oauth/wechat`}>
          <Button
            type="button"
            variant="outline"
            className="w-full border-border bg-card text-foreground"
          >
            使用微信登录
          </Button>
        </a>
      </div>

      {message ? <p className="mt-4 text-sm text-primary">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
