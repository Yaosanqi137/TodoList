import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma/client";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_PREFIX = "encv1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_IV_LENGTH = 12;

@Injectable()
export class DataEncryptionService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>("DATA_ENCRYPTION_SECRET"));
  }

  isEncryptedString(value: string): boolean {
    return value.startsWith(`${ENCRYPTION_PREFIX}:`);
  }

  encryptString(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const key = this.resolveKey();
    const iv = randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTION_PREFIX,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      encrypted.toString("base64url")
    ].join(":");
  }

  decryptString(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || !this.isEncryptedPayload(value)) {
      return value;
    }

    const [prefix, ivText, authTagText, encryptedText] = value.split(":");
    if (prefix !== ENCRYPTION_PREFIX || !ivText || !authTagText || encryptedText === undefined) {
      throw new InternalServerErrorException("加密数据格式无效");
    }

    try {
      const key = this.resolveKey();
      const decipher = createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        Buffer.from(ivText, "base64url")
      );
      decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedText, "base64url")),
        decipher.final()
      ]);

      return decrypted.toString("utf8");
    } catch {
      throw new InternalServerErrorException("加密数据解密失败");
    }
  }

  encryptJson(
    value: Prisma.InputJsonValue | null | undefined
  ): Prisma.InputJsonValue | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    return this.encryptString(JSON.stringify(value));
  }

  decryptJson(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
    if (value === null) {
      return null;
    }

    if (typeof value !== "string" || !this.isEncryptedPayload(value)) {
      return value;
    }

    const decrypted = this.decryptString(value);
    if (typeof decrypted !== "string") {
      throw new InternalServerErrorException("加密数据解密失败");
    }

    try {
      return JSON.parse(decrypted) as Prisma.JsonValue;
    } catch {
      throw new InternalServerErrorException("加密 JSON 数据损坏");
    }
  }

  decryptPayload(value: Prisma.JsonValue | null): string | null {
    if (value === null) {
      return null;
    }

    if (typeof value === "string") {
      return this.decryptString(value) ?? null;
    }

    return JSON.stringify(value);
  }

  private isEncryptedPayload(value: string): boolean {
    return this.isEncryptedString(value);
  }

  private resolveKey(): Buffer {
    const secret = this.configService.get<string>("DATA_ENCRYPTION_SECRET");
    if (!secret) {
      throw new InternalServerErrorException(
        "服务端未配置 DATA_ENCRYPTION_SECRET，无法写入加密数据"
      );
    }

    return createHash("sha256").update(secret, "utf8").digest();
  }
}
