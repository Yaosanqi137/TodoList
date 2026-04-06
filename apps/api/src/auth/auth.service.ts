import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { authenticator } from "@otplib/preset-default";
import { AuthMailService } from "./auth-mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { DataEncryptionService } from "../security/data-encryption.service";

type EmailCodeEntry = {
  code: string;
  expiresAt: number;
};

type AuthUser = {
  id: string;
  email: string;
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

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authMailService: AuthMailService,
    private readonly prismaService: PrismaService,
    private readonly dataEncryptionService: DataEncryptionService
  ) {}

  async sendEmailCode(email: string): Promise<{ success: boolean; expiresInSeconds: number }> {
    const ttlSeconds = Number(this.configService.get("AUTH_EMAIL_CODE_TTL_SECONDS") ?? 300);
    const code = this.generateCode();
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const normalizedEmail = email.toLowerCase();

    await this.authMailService.sendLoginCode(normalizedEmail, code, ttlSeconds);
    this.emailCodeStore.set(normalizedEmail, { code, expiresAt });

    return {
      success: true,
      expiresInSeconds: ttlSeconds
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

    const user = await this.getOrCreateUser(lowerEmail);
    return this.issueTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokenResult> {
    const entry = await this.prismaService.refreshToken.findUnique({
      where: {
        tokenHash: refreshToken
      },
      include: {
        user: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    if (!entry) {
      throw new UnauthorizedException("刷新令牌不存在");
    }

    if (entry.revokedAt) {
      throw new UnauthorizedException("刷新令牌已注销");
    }

    if (entry.expiresAt.getTime() < Date.now()) {
      await this.prismaService.refreshToken.update({
        where: {
          id: entry.id
        },
        data: {
          revokedAt: new Date()
        }
      });
      throw new UnauthorizedException("刷新令牌已过期");
    }

    await this.prismaService.refreshToken.update({
      where: {
        id: entry.id
      },
      data: {
        revokedAt: new Date()
      }
    });

    return this.issueTokens({
      id: entry.user.id,
      email: this.readRequiredEmail(entry.user.email)
    });
  }

  async revokeRefreshToken(refreshToken: string): Promise<{ success: boolean }> {
    await this.prismaService.refreshToken.updateMany({
      where: {
        tokenHash: refreshToken,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return { success: true };
  }

  async enrollTwoFactor(
    email: string
  ): Promise<{ userId: string; secret: string; otpauthUrl: string; enabled: boolean }> {
    const user = await this.getOrCreateUser(email.toLowerCase());
    const secret = authenticator.generateSecret();
    const issuer = this.configService.get<string>("AUTH_TOTP_ISSUER") ?? "TodoList";
    const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);

    await this.prismaService.userSecurity.upsert({
      where: {
        userId: user.id
      },
      update: {
        twoFactorSecret: secret,
        twoFactorEnabled: false
      },
      create: {
        userId: user.id,
        twoFactorSecret: secret,
        twoFactorEnabled: false
      }
    });

    return {
      userId: user.id,
      secret,
      otpauthUrl,
      enabled: false
    };
  }

  async verifyTwoFactor(
    email: string,
    token: string
  ): Promise<{ success: boolean; enabled: boolean }> {
    const user = await this.getOrCreateUser(email.toLowerCase());
    const security = await this.prismaService.userSecurity.findUnique({
      where: {
        userId: user.id
      },
      select: {
        twoFactorSecret: true
      }
    });

    if (!security?.twoFactorSecret) {
      throw new UnauthorizedException("尚未启用两步验证");
    }

    const valid = authenticator.check(token, security.twoFactorSecret);
    if (!valid) {
      throw new UnauthorizedException("两步验证码错误");
    }

    await this.prismaService.userSecurity.update({
      where: {
        userId: user.id
      },
      data: {
        twoFactorEnabled: true
      }
    });

    return {
      success: true,
      enabled: true
    };
  }

  private async getOrCreateUser(email: string): Promise<AuthUser> {
    const normalizedEmail = email.toLowerCase();
    const emailHash = this.dataEncryptionService.createLookupHash("user.email", normalizedEmail);
    const user = await this.prismaService.user.upsert({
      where: {
        emailHash
      },
      update: {},
      create: {
        email: this.encryptRequiredString(normalizedEmail),
        emailHash
      },
      select: {
        id: true,
        email: true
      }
    });

    return {
      id: user.id,
      email: this.readRequiredEmail(user.email)
    };
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

    await this.prismaService.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken,
        expiresAt: new Date(Date.now() + refreshExpiresInSeconds * 1000)
      }
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

  private encryptRequiredString(value: string): string {
    const encryptedValue = this.dataEncryptionService.encryptString(value);
    if (!encryptedValue) {
      throw new UnauthorizedException("用户敏感字段加密失败");
    }

    return encryptedValue;
  }

  private readRequiredEmail(value: string): string {
    const decryptedValue = this.dataEncryptionService.decryptString(value);
    if (typeof decryptedValue !== "string" || decryptedValue.length === 0) {
      throw new UnauthorizedException("用户邮箱解密失败");
    }

    return decryptedValue;
  }
}
