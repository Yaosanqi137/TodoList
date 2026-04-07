import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import {
  AttachmentResponse,
  AttachmentService,
  PresignAttachmentResponse
} from "./attachment.service";
import { CompleteAttachmentDto } from "./dto/complete-attachment.dto";
import { PresignAttachmentDto } from "./dto/presign-attachment.dto";

@Controller("attachments")
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Post("presign")
  async presignAttachment(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: PresignAttachmentDto
  ): Promise<PresignAttachmentResponse> {
    return this.attachmentService.presignAttachment(this.resolveUserId(userIdHeader), body);
  }

  @Post("complete")
  async completeAttachment(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: CompleteAttachmentDto
  ): Promise<AttachmentResponse> {
    return this.attachmentService.completeAttachment(this.resolveUserId(userIdHeader), body);
  }

  private resolveUserId(userIdHeader: string | string[] | undefined): string {
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
      throw new UnauthorizedException("缺少用户上下文");
    }

    return userId;
  }
}
