import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { loginWithEmailCode, sendEmailCode, type EmailLoginResult } from "@/services/auth-api";

type EmailLoginPageProps = {
  onLoginSuccess: (payload: EmailLoginResult) => void;
};

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
      setMessage(`验证码已发送，有效期 ${result.expiresInSeconds} 秒`);

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
    <div className="mx-auto w-full max-w-md rounded-xl border border-[#d7e2db] bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-[#122117]">邮箱验证码登录</h1>
      <p className="mt-2 text-sm text-[#3a5a4a]">输入邮箱后获取验证码，再完成登录。</p>

      <form className="mt-6 space-y-3" onSubmit={handleSendCode}>
        <label className="block text-sm font-medium text-[#244236]" htmlFor="email">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          className="w-full rounded-md border border-[#bfd0c7] px-3 py-2 text-sm outline-none focus:border-[#0a7a5a]"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" disabled={!canSendCode} className="w-full">
          {sendingCode
            ? "发送中..."
            : codeCooldown > 0
              ? `${codeCooldown}s 后可重发`
              : "发送验证码"}
        </Button>
      </form>

      <form className="mt-4 space-y-3" onSubmit={handleLogin}>
        <label className="block text-sm font-medium text-[#244236]" htmlFor="code">
          验证码
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          className="w-full rounded-md border border-[#bfd0c7] px-3 py-2 text-sm outline-none focus:border-[#0a7a5a]"
          placeholder="6位数字验证码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button
          type="submit"
          disabled={!canLogin}
          className="w-full bg-[#0a7a5a] text-white hover:bg-[#0a7a5a]/90"
        >
          {loggingIn ? "登录中..." : "立即登录"}
        </Button>
      </form>

      {message ? <p className="mt-4 text-sm text-[#0a7a5a]">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-[#b42318]">{error}</p> : null}
    </div>
  );
}
