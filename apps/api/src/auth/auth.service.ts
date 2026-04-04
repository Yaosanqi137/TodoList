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

@Injectable()
export class AuthService {
  private readonly emailCodeStore = new Map<string, EmailCodeEntry>();
  private readonly userStore = new Map<string, AuthUser>();

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

  async loginWithEmailCode(
    email: string,
    code: string
  ): Promise<{
    accessToken: string;
    tokenType: "Bearer";
    expiresInSeconds: number;
    user: AuthUser;
  }> {
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
    const expiresInSeconds = Number(
      this.configService.get("AUTH_ACCESS_EXPIRES_IN_SECONDS") ?? 900
    );
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresInSeconds,
      user
    };
  }

  private getOrCreateUser(email: string): AuthUser {
    const existingUser = this.userStore.get(email);
    if (existingUser) {
      return existingUser;
    }

    const newUser = {
      id: randomUUID(),
      email
    };
    this.userStore.set(email, newUser);

    return newUser;
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }
}
