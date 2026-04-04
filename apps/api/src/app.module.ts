import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AttachmentModule } from "./attachment/attachment.module";
import { AuthModule } from "./auth/auth.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TaskModule } from "./task/task.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env"
    }),
    PrismaModule,
    AuthModule,
    TaskModule,
    AttachmentModule
  ]
})
export class AppModule {}
