import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
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

@Injectable()
export class SyncService {
  constructor(private readonly prismaService: PrismaService) {}

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

  private isDuplicateOpIdError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    return error.code === "P2002";
  }
}
