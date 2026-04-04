export type SendEmailCodeResult = {
  success: boolean;
  expiresInSeconds: number;
};

export type EmailLoginResult = {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresInSeconds: number;
  user: {
    id: string;
    email: string;
  };
};

const DEFAULT_API_BASE_URL = "http://localhost:3000";

function resolveApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!envBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  return envBaseUrl.replace(/\/+$/, "");
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join("；");
    }
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  } catch {
    return `请求失败（${response.status}）`;
  }

  return `请求失败（${response.status}）`;
}

export async function sendEmailCode(email: string): Promise<SendEmailCodeResult> {
  const response = await fetch(`${resolveApiBaseUrl()}/auth/email/send-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const body = (await response.json()) as SendEmailCodeResult;
  return body;
}

export async function loginWithEmailCode(email: string, code: string): Promise<EmailLoginResult> {
  const response = await fetch(`${resolveApiBaseUrl()}/auth/email/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, code })
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const body = (await response.json()) as EmailLoginResult;
  return body;
}
