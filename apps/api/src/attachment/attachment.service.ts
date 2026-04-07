import { randomUUID } from "node:crypto";
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AttachmentType } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DataEncryptionService } from "../security/data-encryption.service";
import { CompleteAttachmentDto } from "./dto/complete-attachment.dto";
import { PresignAttachmentDto } from "./dto/presign-attachment.dto";

type QuotaInfo = {
  totalBytes: bigint;
  usedBytes: bigint;
};

export type PresignAttachmentResponse = {
  method: "PUT";
  uploadUrl: string;
  bucket: string;
  objectKey: string;
  objectUrl: string;
  expiresInSeconds: number;
  quota: {
    totalBytes: string;
    usedBytes: string;
    remainingBytes: string;
  };
  headers: Record<string, string>;
};

export type AttachmentResponse = {
  id: string;
  taskId: string | null;
  type: AttachmentType;
  url: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class AttachmentService {
  private s3Client: S3Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly dataEncryptionService: DataEncryptionService
  ) {}

  async presignAttachment(
    userId: string,
    body: PresignAttachmentDto
  ): Promise<PresignAttachmentResponse> {
    const quotaInfo = await this.getQuotaSnapshot(userId);
    this.assertQuotaAvailable(quotaInfo.totalBytes, quotaInfo.usedBytes, body.fileSize);

    if (body.taskId) {
      await this.ensureTaskOwnership(userId, body.taskId);
    }

    const bucket = this.getDefaultBucket();
    const objectKey = this.generateObjectKey(body.fileName);
    const objectUrl = this.resolveObjectUrl(bucket, objectKey);
    const expiresInSeconds = this.getPresignExpiresInSeconds();
    const serverSideEncryption = this.getServerSideEncryptionMode();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: body.mimeType,
      ContentLength: body.fileSize,
      ServerSideEncryption: serverSideEncryption
    });

    const uploadUrl = await getSignedUrl(this.getS3Client(), command, {
      expiresIn: expiresInSeconds
    });

    return {
      method: "PUT",
      uploadUrl,
      bucket,
      objectKey,
      objectUrl,
      expiresInSeconds,
      quota: {
        totalBytes: quotaInfo.totalBytes.toString(),
        usedBytes: quotaInfo.usedBytes.toString(),
        remainingBytes: (quotaInfo.totalBytes - quotaInfo.usedBytes).toString()
      },
      headers: this.buildUploadHeaders(body.mimeType, serverSideEncryption)
    };
  }

  async completeAttachment(
    userId: string,
    body: CompleteAttachmentDto
  ): Promise<AttachmentResponse> {
    if (body.taskId) {
      await this.ensureTaskOwnership(userId, body.taskId);
    }

    const bucket = body.bucket ?? this.getDefaultBucket();
    const objectUrl = this.resolveObjectUrl(bucket, body.objectKey);

    const attachment = await this.prismaService.$transaction(async (tx) => {
      const quotaInfo = await this.getQuotaSnapshot(userId, tx);
      this.assertQuotaAvailable(quotaInfo.totalBytes, quotaInfo.usedBytes, body.fileSize);

      const uploadBytes = BigInt(body.fileSize);
      const maxUsedBeforeUpload = quotaInfo.totalBytes - uploadBytes;
      const updatedUser = await tx.user.updateMany({
        where: {
          id: userId,
          usedStorageBytes: {
            lte: maxUsedBeforeUpload
          }
        },
        data: {
          usedStorageBytes: {
            increment: uploadBytes
          }
        }
      });
      if (updatedUser.count === 0) {
        throw new PayloadTooLargeException("存储配额不足");
      }

      return tx.attachment.create({
        data: {
          userId,
          taskId: body.taskId ?? null,
          type: body.type ?? this.resolveAttachmentType(body.mimeType),
          url: this.encryptRequiredString(objectUrl),
          mimeType: body.mimeType,
          fileName: this.encryptNullableString(body.fileName),
          fileSize: body.fileSize,
          width: body.width ?? null,
          height: body.height ?? null,
          durationMs: body.durationMs ?? null,
          checksum: this.encryptNullableString(body.checksum)
        }
      });
    });

    return {
      id: attachment.id,
      taskId: attachment.taskId,
      type: attachment.type,
      url: this.readDecryptedString(attachment.url) ?? objectUrl,
      mimeType: attachment.mimeType,
      fileName: this.readDecryptedString(attachment.fileName),
      fileSize: attachment.fileSize,
      width: attachment.width,
      height: attachment.height,
      durationMs: attachment.durationMs,
      checksum: this.readDecryptedString(attachment.checksum),
      createdAt: attachment.createdAt.toISOString(),
      updatedAt: attachment.updatedAt.toISOString()
    };
  }

  private getS3Client(): S3Client {
    if (this.s3Client) {
      return this.s3Client;
    }

    const endpoint = this.configService.get<string>("S3_ENDPOINT") ?? "http://127.0.0.1:9000";
    const region = this.configService.get<string>("S3_REGION") ?? "us-east-1";
    const forcePathStyle =
      this.configService.get<string>("S3_FORCE_PATH_STYLE")?.toLowerCase() !== "false";

    this.s3Client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: {
        accessKeyId: this.configService.get<string>("S3_ACCESS_KEY_ID") ?? "minioadmin",
        secretAccessKey: this.configService.get<string>("S3_SECRET_ACCESS_KEY") ?? "minioadmin"
      }
    });

    return this.s3Client;
  }

  private getDefaultBucket(): string {
    return this.configService.get<string>("S3_BUCKET") ?? "todolist";
  }

  private getPresignExpiresInSeconds(): number {
    const configValue = Number(this.configService.get<string>("S3_PRESIGN_EXPIRES_SECONDS") ?? 900);
    if (!Number.isFinite(configValue) || configValue <= 0) {
      return 900;
    }

    return Math.min(configValue, 604800);
  }

  private generateObjectKey(fileName: string): string {
    const datePrefix = new Date().toISOString().slice(0, 10);
    return `attachments/${datePrefix}/${randomUUID()}${this.extractFileExtension(fileName)}`;
  }

  private resolveObjectUrl(bucket: string, objectKey: string): string {
    const publicBaseUrl = this.configService.get<string>("S3_PUBLIC_BASE_URL");
    if (publicBaseUrl) {
      return `${publicBaseUrl.replace(/\/+$/, "")}/${bucket}/${objectKey}`;
    }

    const endpoint = this.configService.get<string>("S3_ENDPOINT") ?? "http://127.0.0.1:9000";
    return `${endpoint.replace(/\/+$/, "")}/${bucket}/${objectKey}`;
  }

  private resolveAttachmentType(mimeType: string): AttachmentType {
    if (mimeType.startsWith("image/")) {
      return AttachmentType.IMAGE;
    }

    if (mimeType.startsWith("video/")) {
      return AttachmentType.VIDEO;
    }

    return AttachmentType.FILE;
  }

  private buildUploadHeaders(
    mimeType: string,
    serverSideEncryption: "AES256" | undefined
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": mimeType
    };

    if (serverSideEncryption) {
      headers["x-amz-server-side-encryption"] = serverSideEncryption;
    }

    return headers;
  }

  private getServerSideEncryptionMode(): "AES256" | undefined {
    const configValue =
      this.configService.get<string>("S3_SERVER_SIDE_ENCRYPTION")?.trim().toUpperCase() ?? "AES256";

    if (configValue === "NONE" || configValue === "DISABLED") {
      return undefined;
    }

    return "AES256";
  }

  private extractFileExtension(fileName: string): string {
    const match = /\.[a-zA-Z0-9]{1,16}$/.exec(fileName);
    return match?.[0]?.toLowerCase() ?? "";
  }

  private async ensureTaskOwnership(userId: string, taskId: string): Promise<void> {
    const task = await this.prismaService.task.findFirst({
      where: {
        id: taskId,
        userId
      },
      select: {
        id: true
      }
    });

    if (!task) {
      throw new NotFoundException("任务不存在");
    }
  }

  private async getQuotaSnapshot(
    userId: string,
    tx: Pick<PrismaService, "user"> = this.prismaService
  ): Promise<QuotaInfo> {
    const user = await tx.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        defaultStorageQuotaMb: true,
        usedStorageBytes: true
      }
    });

    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    return {
      totalBytes: BigInt(user.defaultStorageQuotaMb) * 1024n * 1024n,
      usedBytes: user.usedStorageBytes
    };
  }

  private assertQuotaAvailable(totalBytes: bigint, usedBytes: bigint, fileSize: number): void {
    const uploadBytes = BigInt(fileSize);
    if (uploadBytes > totalBytes || usedBytes + uploadBytes > totalBytes) {
      throw new PayloadTooLargeException("存储配额不足");
    }
  }

  private encryptRequiredString(value: string): string {
    const encryptedValue = this.dataEncryptionService.encryptString(value);
    if (!encryptedValue) {
      throw new InternalServerErrorException("附件元数据加密失败");
    }

    return encryptedValue;
  }

  private encryptNullableString(value: string | null | undefined): string | null | undefined {
    return this.dataEncryptionService.encryptString(value);
  }

  private readDecryptedString(value: string | null): string | null {
    const decryptedValue = this.dataEncryptionService.decryptString(value);
    return typeof decryptedValue === "string" ? decryptedValue : null;
  }
}
