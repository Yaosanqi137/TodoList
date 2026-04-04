import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TaskController } from "./task.controller";
import { TaskService } from "./task.service";

@Module({
  imports: [PrismaModule],
  controllers: [TaskController],
  providers: [TaskService]
})
export class TaskModule {}
