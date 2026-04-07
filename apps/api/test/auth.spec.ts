import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthMailService } from "../src/auth/auth-mail.service";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { DataEncryptionService } from "../src/security/data-encryption.service";

type UserRecord = {
  id: string;
  email: string;
  emailHash: string;
  nickname: string | null;
  avatarUrl: string | null;
};

type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

type UserSecurityRecord = {
  userId: string;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
};

class InMemoryAuthPrismaService {
  private userIdSequence = 1;
  private refreshTokenIdSequence = 1;
  private users: UserRecord[] = [];
  private refreshTokens: RefreshTokenRecord[] = [];
  private userSecurities: UserSecurityRecord[] = [];

  readonly user = {
    upsert: async (args: {
      where: {
        emailHash: string;
      };
      update: Record<string, never>;
      create: {
        email: string;
        emailHash: string;
      };
      select: {
        id: true;
        email: true;
      };
    }) => {
      const existingUser = this.users.find((user) => user.emailHash === args.where.emailHash);
      if (existingUser) {
        return {
          id: existingUser.id,
          email: existingUser.email
        };
      }

      const createdUser: UserRecord = {
        id: `user_${this.userIdSequence++}`,
        email: args.create.email,
        emailHash: args.create.emailHash,
        nickname: null,
        avatarUrl: null
      };
      this.users.push(createdUser);

      return {
        id: createdUser.id,
        email: createdUser.email
      };
    }
  };

  readonly refreshToken = {
    create: async (args: {
      data: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
      };
    }) => {
      const refreshToken: RefreshTokenRecord = {
        id: `refresh_${this.refreshTokenIdSequence++}`,
        userId: args.data.userId,
        tokenHash: args.data.tokenHash,
        expiresAt: args.data.expiresAt,
        revokedAt: null,
        createdAt: new Date()
      };
      this.refreshTokens.push(refreshToken);
      return refreshToken;
    },

    findUnique: async (args: {
      where: {
        tokenHash: string;
      };
      include: {
        user: {
          select: {
            id: true;
            email: true;
          };
        };
      };
    }) => {
      const refreshToken = this.refreshTokens.find(
        (item) => item.tokenHash === args.where.tokenHash
      );
      if (!refreshToken) {
        return null;
      }

      const user = this.users.find((item) => item.id === refreshToken.userId);
      if (!user) {
        throw new Error("user not found");
      }

      return {
        ...refreshToken,
        user: {
          id: user.id,
          email: user.email
        }
      };
    },

    update: async (args: {
      where: {
        id: string;
      };
      data: {
        revokedAt: Date;
      };
    }) => {
      const refreshToken = this.refreshTokens.find((item) => item.id === args.where.id);
      if (!refreshToken) {
        throw new Error("refresh token not found");
      }

      refreshToken.revokedAt = args.data.revokedAt;
      return refreshToken;
    },

    updateMany: async (args: {
      where: {
        tokenHash: string;
        revokedAt: null;
      };
      data: {
        revokedAt: Date;
      };
    }) => {
      let count = 0;
      for (const refreshToken of this.refreshTokens) {
        if (refreshToken.tokenHash !== args.where.tokenHash || refreshToken.revokedAt !== null) {
          continue;
        }

        refreshToken.revokedAt = args.data.revokedAt;
        count += 1;
      }

      return { count };
    }
  };

  readonly userSecurity = {
    upsert: async (args: {
      where: {
        userId: string;
      };
      update: {
        twoFactorSecret: string;
        twoFactorEnabled: boolean;
      };
      create: {
        userId: string;
        twoFactorSecret: string;
        twoFactorEnabled: boolean;
      };
    }) => {
      const existingSecurity = this.userSecurities.find(
        (item) => item.userId === args.where.userId
      );
      if (existingSecurity) {
        existingSecurity.twoFactorSecret = args.update.twoFactorSecret;
        existingSecurity.twoFactorEnabled = args.update.twoFactorEnabled;
        return existingSecurity;
      }

      const createdSecurity: UserSecurityRecord = {
        userId: args.create.userId,
        twoFactorSecret: args.create.twoFactorSecret,
        twoFactorEnabled: args.create.twoFactorEnabled
      };
      this.userSecurities.push(createdSecurity);
      return createdSecurity;
    },

    findUnique: async (args: {
      where: {
        userId: string;
      };
      select: {
        twoFactorSecret: true;
      };
    }) => {
      const security = this.userSecurities.find((item) => item.userId === args.where.userId);
      if (!security) {
        return null;
      }

      return {
        twoFactorSecret: security.twoFactorSecret
      };
    },

    update: async (args: {
      where: {
        userId: string;
      };
      data: {
        twoFactorEnabled: boolean;
      };
    }) => {
      const security = this.userSecurities.find((item) => item.userId === args.where.userId);
      if (!security) {
        throw new Error("user security not found");
      }

      security.twoFactorEnabled = args.data.twoFactorEnabled;
      return security;
    }
  };

  getUsers(): UserRecord[] {
    return [...this.users];
  }
}

class MockAuthMailService {
  readonly sentMessages: Array<{
    email: string;
    code: string;
    ttlSeconds: number;
  }> = [];

  async sendLoginCode(email: string, code: string, ttlSeconds: number): Promise<void> {
    this.sentMessages.push({
      email,
      code,
      ttlSeconds
    });
  }
}

describe("AuthService", () => {
  let authService: AuthService;
  let prismaService: InMemoryAuthPrismaService;
  let authMailService: MockAuthMailService;

  beforeEach(async () => {
    prismaService = new InMemoryAuthPrismaService();
    authMailService = new MockAuthMailService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        DataEncryptionService,
        {
          provide: PrismaService,
          useValue: prismaService
        },
        {
          provide: AuthMailService,
          useValue: authMailService
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: async (payload: Record<string, unknown>) =>
              `signed-${String(payload["sub"])}-${String(payload["email"])}`
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              switch (key) {
                case "AUTH_EMAIL_CODE_TTL_SECONDS":
                  return "300";
                case "AUTH_ACCESS_EXPIRES_IN_SECONDS":
                  return "900";
                case "AUTH_REFRESH_EXPIRES_IN_SECONDS":
                  return "2592000";
                case "AUTH_TOTP_ISSUER":
                  return "TodoList";
                case "DATA_ENCRYPTION_SECRET":
                  return "test-data-encryption-secret";
                default:
                  return undefined;
              }
            }
          }
        }
      ]
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  it("should encrypt user email in database while keeping login flow available", async () => {
    await authService.sendEmailCode("User@Example.com");
    expect(authMailService.sentMessages).toHaveLength(1);
    expect(authMailService.sentMessages[0]?.email).toBe("user@example.com");

    const loginResult = await authService.loginWithEmailCode(
      "USER@example.com",
      authMailService.sentMessages[0]?.code ?? ""
    );

    expect(loginResult.user.email).toBe("user@example.com");
    expect(loginResult.accessToken).toContain("user@example.com");

    const storedUser = prismaService.getUsers()[0];
    expect(storedUser?.email).not.toBe("user@example.com");
    expect(storedUser?.emailHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should decrypt user email when refreshing token", async () => {
    await authService.sendEmailCode("refresh@example.com");
    const loginResult = await authService.loginWithEmailCode(
      "refresh@example.com",
      authMailService.sentMessages[0]?.code ?? ""
    );

    const refreshResult = await authService.refreshTokens(loginResult.refreshToken);
    expect(refreshResult.user.email).toBe("refresh@example.com");
    expect(refreshResult.accessToken).toContain("refresh@example.com");
  });

  it("should reject invalid verification code", async () => {
    await authService.sendEmailCode("invalid@example.com");

    await expect(
      authService.loginWithEmailCode("invalid@example.com", "000000")
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
