import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";

type EmailCodeEntry = {
  code: string;
  expiresAt: number;
};

type AuthUser = {
  id: string;
  email: string;
};

type RefreshTokenEntry = {
  userId: string;
  expiresAt: number;
  revokedAt?: number;
};

type AuthTokenResult = {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresInSeconds: number;
  user: AuthUser;
};

@Injectable()
export class AuthService {
  private readonly emailCodeStore = new Map<string, EmailCodeEntry>();
  private readonly userStoreByEmail = new Map<string, AuthUser>();
  private readonly userStoreById = new Map<string, AuthUser>();
  private readonly refreshTokenStore = new Map<string, RefreshTokenEntry>();

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService
  ) {}

  async sendEmailCode(
    email: string
  ): Promise<{ success: boolean; expiresInSeconds: number; debugCode: string }> {
    const ttlSeconds = Number(this.configService.get("AUTH_EMAIL_CODE_TTL_SECONDS") ?? 300);
    const code = this.generateCode();
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.emailCodeStore.set(email.toLowerCase(), { code, expiresAt });

    return {
      success: true,
      expiresInSeconds: ttlSeconds,
      debugCode: code
    };
  }

  async loginWithEmailCode(email: string, code: string): Promise<AuthTokenResult> {
    const lowerEmail = email.toLowerCase();
    const codeEntry = this.emailCodeStore.get(lowerEmail);

    if (!codeEntry) {
      throw new UnauthorizedException("验证码不存在或已失效");
    }

    if (codeEntry.expiresAt < Date.now()) {
      this.emailCodeStore.delete(lowerEmail);
      throw new UnauthorizedException("验证码已过期");
    }

    if (codeEntry.code !== code) {
      throw new UnauthorizedException("验证码错误");
    }

    this.emailCodeStore.delete(lowerEmail);

    const user = this.getOrCreateUser(lowerEmail);
    return this.issueTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokenResult> {
    const entry = this.refreshTokenStore.get(refreshToken);
    if (!entry) {
      throw new UnauthorizedException("刷新令牌不存在");
    }
    if (entry.revokedAt) {
      throw new UnauthorizedException("刷新令牌已注销");
    }
    if (entry.expiresAt < Date.now()) {
      this.refreshTokenStore.delete(refreshToken);
      throw new UnauthorizedException("刷新令牌已过期");
    }

    const user = this.userStoreById.get(entry.userId);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    entry.revokedAt = Date.now();
    return this.issueTokens(user);
  }

  async revokeRefreshToken(refreshToken: string): Promise<{ success: boolean }> {
    const entry = this.refreshTokenStore.get(refreshToken);
    if (!entry) {
      return { success: true };
    }

    entry.revokedAt = Date.now();
    return { success: true };
  }

  private getOrCreateUser(email: string): AuthUser {
    const existingUser = this.userStoreByEmail.get(email);
    if (existingUser) {
      return existingUser;
    }

    const newUser = {
      id: randomUUID(),
      email
    };
    this.userStoreByEmail.set(email, newUser);
    this.userStoreById.set(newUser.id, newUser);

    return newUser;
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async issueTokens(user: AuthUser): Promise<AuthTokenResult> {
    const accessExpiresInSeconds = Number(
      this.configService.get("AUTH_ACCESS_EXPIRES_IN_SECONDS") ?? 900
    );
    const refreshExpiresInSeconds = Number(
      this.configService.get("AUTH_REFRESH_EXPIRES_IN_SECONDS") ?? 2592000
    );
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email
    });
    const refreshToken = `${randomUUID()}${randomUUID()}`;

    this.refreshTokenStore.set(refreshToken, {
      userId: user.id,
      expiresAt: Date.now() + refreshExpiresInSeconds * 1000
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresInSeconds: accessExpiresInSeconds,
      refreshToken,
      refreshExpiresInSeconds,
      user
    };
  }
}
