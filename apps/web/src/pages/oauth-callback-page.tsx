import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { saveSession, type WebSession } from "@/services/session-storage";

type OAuthCallbackPageProps = {
  onBootstrapSession: (session: WebSession) => void;
};

export function OAuthCallbackPage({ onBootstrapSession }: OAuthCallbackPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const parseResult = useMemo(() => {
    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");
    const userId = searchParams.get("userId");
    const email = searchParams.get("email");

    if (!accessToken || !refreshToken || !userId || !email) {
      return {
        ok: false as const,
        reason: "回调参数不完整，暂时无法建立会话。"
      };
    }

    return {
      ok: true as const,
      session: {
        accessToken,
        refreshToken,
        user: {
          id: userId,
          email
        }
      }
    };
  }, [searchParams]);

  function handleContinue(): void {
    if (!parseResult.ok) {
      navigate("/login/email", { replace: true });
      return;
    }

    saveSession(parseResult.session);
    onBootstrapSession(parseResult.session);
    navigate("/", { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card/92 p-6 shadow-[0_24px_60px_-36px_hsl(var(--primary)/0.55)] backdrop-blur">
      <div className="mb-4 flex items-center gap-3">
        <img src="/favicon.png" alt="TodoList" className="h-10 w-10 rounded-xl shadow-sm" />
        <h1 className="text-2xl font-semibold text-foreground">OAuth 回调处理中</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {parseResult.ok ? "已收到回调参数，点击继续进入工作台。" : parseResult.reason}
      </p>
      <Button
        className="mt-6 w-full bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95"
        onClick={handleContinue}
      >
        {parseResult.ok ? "继续" : "返回邮箱登录"}
      </Button>
    </div>
  );
}
