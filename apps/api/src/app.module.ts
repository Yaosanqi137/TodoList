import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AiModule } from "./ai/ai.module";
import { AttachmentModule } from "./attachment/attachment.module";
import { AuthModule } from "./auth/auth.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SecurityModule } from "./security/security.module";
import { SyncModule } from "./sync/sync.module";
import { TaskModule } from "./task/task.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env"
    }),
    PrismaModule,
    SecurityModule,
    AuthModule,
    TaskModule,
    AttachmentModule,
    SyncModule,
    AiModule
  ]
})
export class AppModule {}
