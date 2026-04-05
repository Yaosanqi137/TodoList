import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SyncPullQueryDto } from "./dto/sync-pull.dto";
import { SyncPushDto, SyncPushOperationDto } from "./dto/sync-push.dto";

export type SyncPushItemStatus = "accepted" | "duplicate" | "failed";

export type SyncPushItemResult = {
  opId: string;
  status: SyncPushItemStatus;
  serverTs: string | null;
  reason: string | null;
};

export type SyncPushResponse = {
  acceptedCount: number;
  duplicateCount: number;
  failedCount: number;
  results: SyncPushItemResult[];
};

type ExistingOperationRecord = {
  opId: string;
  serverTs: Date;
};

type SyncPullCursorState = {
  serverTs: string;
  opId: string;
};

type SyncPullOperationRecord = {
  opId: string;
  entityId: string;
  entityType: string;
  action: string;
  payload: Prisma.JsonValue | null;
  clientTs: Date;
  deviceId: string;
  serverTs: Date;
};

export type SyncPullItem = {
  opId: string;
  entityId: string;
  entityType: string;
  action: string;
  payload: string | null;
  clientTs: number;
  deviceId: string;
  serverTs: string;
};

export type SyncPullResponse = {
  items: SyncPullItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

@Injectable()
export class SyncService {
  constructor(private readonly prismaService: PrismaService) {}

  async pullOperations(userId: string, query: SyncPullQueryDto): Promise<SyncPullResponse> {
    const limit = query.limit ?? 100;
    const cursor = this.parseCursor(query.cursor);

    const operations = (await this.prismaService.syncOperation.findMany({
      where: this.buildPullWhereInput(userId, cursor),
      orderBy: [{ serverTs: "asc" }, { opId: "asc" }],
      take: limit + 1,
      select: {
        opId: true,
        entityId: true,
        entityType: true,
        action: true,
        payload: true,
        clientTs: true,
        deviceId: true,
        serverTs: true
      }
    })) as SyncPullOperationRecord[];

    const hasMore = operations.length > limit;
    const pageItems = hasMore ? operations.slice(0, limit) : operations;
    const lastOperation = pageItems.at(-1);

    return {
      items: pageItems.map((operation) => this.serializePullItem(operation)),
      nextCursor: lastOperation
        ? this.encodeCursor({
            serverTs: lastOperation.serverTs.toISOString(),
            opId: lastOperation.opId
          })
        : (query.cursor ?? null),
      hasMore
    };
  }

  async pushOperations(userId: string, body: SyncPushDto): Promise<SyncPushResponse> {
    const existingOperations = await this.loadExistingOperations(userId, body.operations);
    const results: SyncPushItemResult[] = [];
    const seenOperationIds = new Set<string>();
    const acceptedOperationServerTs = new Map<string, string>();

    for (const operation of body.operations) {
      if (seenOperationIds.has(operation.opId)) {
        results.push({
          opId: operation.opId,
          status: "duplicate",
          serverTs: acceptedOperationServerTs.get(operation.opId) ?? null,
          reason: "same_batch_duplicate"
        });
        continue;
      }

      seenOperationIds.add(operation.opId);

      const existingOperation = existingOperations.get(operation.opId);
      if (existingOperation) {
        results.push({
          opId: operation.opId,
          status: "duplicate",
          serverTs: existingOperation.serverTs.toISOString(),
          reason: "already_synced"
        });
        continue;
      }

      try {
        const createdOperation = await this.prismaService.syncOperation.create({
          data: {
            opId: operation.opId,
            userId,
            deviceId: operation.deviceId,
            entityType: operation.entityType,
            entityId: operation.entityId,
            action: operation.action,
            payload: operation.payload,
            clientTs: new Date(operation.clientTs)
          },
          select: {
            opId: true,
            serverTs: true
          }
        });

        const serverTs = createdOperation.serverTs.toISOString();
        acceptedOperationServerTs.set(createdOperation.opId, serverTs);
        results.push({
          opId: createdOperation.opId,
          status: "accepted",
          serverTs,
          reason: null
        });
      } catch (error) {
        if (this.isDuplicateOpIdError(error)) {
          results.push({
            opId: operation.opId,
            status: "duplicate",
            serverTs: null,
            reason: "already_synced"
          });
          continue;
        }

        results.push({
          opId: operation.opId,
          status: "failed",
          serverTs: null,
          reason: "persist_failed"
        });
      }
    }

    return {
      acceptedCount: results.filter((item) => item.status === "accepted").length,
      duplicateCount: results.filter((item) => item.status === "duplicate").length,
      failedCount: results.filter((item) => item.status === "failed").length,
      results
    };
  }

  private async loadExistingOperations(
    userId: string,
    operations: SyncPushOperationDto[]
  ): Promise<Map<string, ExistingOperationRecord>> {
    const opIds = Array.from(new Set(operations.map((operation) => operation.opId)));

    const existingOperations = (await this.prismaService.syncOperation.findMany({
      where: {
        userId,
        opId: {
          in: opIds
        }
      },
      select: {
        opId: true,
        serverTs: true
      }
    })) as ExistingOperationRecord[];

    return new Map(
      existingOperations.map((operation): [string, ExistingOperationRecord] => [
        operation.opId,
        operation
      ])
    );
  }

  private buildPullWhereInput(
    userId: string,
    cursor: SyncPullCursorState | null
  ): Prisma.SyncOperationWhereInput {
    if (!cursor) {
      return { userId };
    }

    const cursorDate = new Date(cursor.serverTs);

    return {
      userId,
      // 同一毫秒内可能有多条操作，必须使用 opId 作为二级游标来保证稳定分页。
      OR: [
        {
          serverTs: {
            gt: cursorDate
          }
        },
        {
          serverTs: cursorDate,
          opId: {
            gt: cursor.opId
          }
        }
      ]
    };
  }

  private serializePullItem(operation: SyncPullOperationRecord): SyncPullItem {
    return {
      opId: operation.opId,
      entityId: operation.entityId,
      entityType: operation.entityType,
      action: operation.action,
      payload: this.serializePayload(operation.payload),
      clientTs: operation.clientTs.getTime(),
      deviceId: operation.deviceId,
      serverTs: operation.serverTs.toISOString()
    };
  }

  private serializePayload(payload: Prisma.JsonValue | null): string | null {
    if (payload === null) {
      return null;
    }

    if (typeof payload === "string") {
      return payload;
    }

    return JSON.stringify(payload);
  }

  private parseCursor(cursor: string | undefined): SyncPullCursorState | null {
    if (!cursor) {
      return null;
    }

    let decodedCursor: unknown;
    try {
      decodedCursor = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid sync cursor");
    }

    if (typeof decodedCursor !== "object" || decodedCursor === null) {
      throw new BadRequestException("Invalid sync cursor");
    }

    const cursorRecord = decodedCursor as {
      serverTs?: unknown;
      opId?: unknown;
    };

    if (
      typeof cursorRecord.serverTs !== "string" ||
      typeof cursorRecord.opId !== "string" ||
      Number.isNaN(Date.parse(cursorRecord.serverTs)) ||
      cursorRecord.opId.trim().length === 0
    ) {
      throw new BadRequestException("Invalid sync cursor");
    }

    return {
      serverTs: cursorRecord.serverTs,
      opId: cursorRecord.opId
    };
  }

  private encodeCursor(cursor: SyncPullCursorState): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  private isDuplicateOpIdError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    return error.code === "P2002";
  }
}
