import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AttachmentController } from "./attachment.controller";
import { AttachmentService } from "./attachment.service";

@Module({
  imports: [PrismaModule],
  controllers: [AttachmentController],
  providers: [AttachmentService]
})
export class AttachmentModule {}
