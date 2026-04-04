import type { EmailLoginResult } from "@/services/auth-api";

const SESSION_STORAGE_KEY = "todolist.web.session";

export type WebSession = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
  };
};

function isValidSession(payload: unknown): payload is WebSession {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const data = payload as {
    accessToken?: unknown;
    refreshToken?: unknown;
    user?: {
      id?: unknown;
      email?: unknown;
    };
  };

  return (
    typeof data.accessToken === "string" &&
    typeof data.refreshToken === "string" &&
    typeof data.user?.id === "string" &&
    typeof data.user?.email === "string"
  );
}

export function loadSession(): WebSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSession(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(payload: EmailLoginResult | WebSession): void {
  const session: WebSession = {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    user: {
      id: payload.user.id,
      email: payload.user.email
    }
  };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
