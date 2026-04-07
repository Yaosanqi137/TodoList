import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type AiRateLimitBucket = {
  count: number;
  resetAt: number;
};

export type AiRateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: "USER" | "IP";
      retryAfterMs: number;
      limit: number;
      windowMs: number;
    };

@Injectable()
export class AiRateLimitService {
  private readonly userBuckets = new Map<string, AiRateLimitBucket>();
  private readonly ipBuckets = new Map<string, AiRateLimitBucket>();
  private readonly windowMs: number;
  private readonly userLimit: number;
  private readonly ipLimit: number;

  constructor(private readonly configService: ConfigService) {
    this.windowMs = this.readPositiveInt("AI_RATE_LIMIT_WINDOW_MS", 60_000);
    this.userLimit = this.readPositiveInt("AI_RATE_LIMIT_USER_MAX", 20);
    this.ipLimit = this.readPositiveInt("AI_RATE_LIMIT_IP_MAX", 60);
  }

  consume(userId: string, clientIp: string | null): AiRateLimitResult {
    const now = Date.now();
    const userBucket = this.getBucket(this.userBuckets, userId, now);
    if (userBucket.count >= this.userLimit) {
      return {
        allowed: false,
        reason: "USER",
        retryAfterMs: Math.max(0, userBucket.resetAt - now),
        limit: this.userLimit,
        windowMs: this.windowMs
      };
    }

    const normalizedIp = this.normalizeIp(clientIp);
    const ipBucket = normalizedIp ? this.getBucket(this.ipBuckets, normalizedIp, now) : null;
    if (ipBucket && ipBucket.count >= this.ipLimit) {
      return {
        allowed: false,
        reason: "IP",
        retryAfterMs: Math.max(0, ipBucket.resetAt - now),
        limit: this.ipLimit,
        windowMs: this.windowMs
      };
    }

    userBucket.count += 1;
    if (ipBucket) {
      ipBucket.count += 1;
    }

    this.cleanupExpiredBuckets(this.userBuckets, now);
    this.cleanupExpiredBuckets(this.ipBuckets, now);

    return {
      allowed: true
    };
  }

  private getBucket(
    buckets: Map<string, AiRateLimitBucket>,
    key: string,
    now: number
  ): AiRateLimitBucket {
    const currentBucket = buckets.get(key);
    if (!currentBucket || now >= currentBucket.resetAt) {
      const nextBucket: AiRateLimitBucket = {
        count: 0,
        resetAt: now + this.windowMs
      };
      buckets.set(key, nextBucket);
      return nextBucket;
    }

    return currentBucket;
  }

  private cleanupExpiredBuckets(buckets: Map<string, AiRateLimitBucket>, now: number): void {
    if (buckets.size <= 256) {
      return;
    }

    for (const [key, bucket] of buckets.entries()) {
      if (now >= bucket.resetAt) {
        buckets.delete(key);
      }
    }
  }

  private normalizeIp(clientIp: string | null): string | null {
    if (!clientIp) {
      return null;
    }

    const normalizedIp = clientIp.trim();
    return normalizedIp.length > 0 ? normalizedIp : null;
  }

  private readPositiveInt(key: string, fallbackValue: number): number {
    const rawValue = this.configService.get<string | number | undefined>(key);
    const parsedValue =
      typeof rawValue === "number" ? rawValue : Number.parseInt(String(rawValue ?? ""), 10);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return fallbackValue;
    }

    return parsedValue;
  }
}
