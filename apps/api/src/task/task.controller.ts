import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import { CreateTaskDto } from "./dto/create-task.dto";
import { ListTasksQueryDto } from "./dto/list-tasks-query.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { ListTasksResponse, TaskResponse, TaskService } from "./task.service";

@Controller("tasks")
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  async listTasks(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Query() query: ListTasksQueryDto
  ): Promise<ListTasksResponse> {
    return this.taskService.listTasks(this.resolveUserId(userIdHeader), query);
  }

  @Get(":taskId")
  async getTaskById(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Param("taskId") taskId: string
  ): Promise<TaskResponse> {
    return this.taskService.getTaskById(this.resolveUserId(userIdHeader), taskId);
  }

  @Post()
  async createTask(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: CreateTaskDto
  ): Promise<TaskResponse> {
    return this.taskService.createTask(this.resolveUserId(userIdHeader), body);
  }

  @Patch(":taskId")
  async updateTask(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Param("taskId") taskId: string,
    @Body() body: UpdateTaskDto
  ): Promise<TaskResponse> {
    return this.taskService.updateTask(this.resolveUserId(userIdHeader), taskId, body);
  }

  @Delete(":taskId")
  async deleteTask(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Param("taskId") taskId: string
  ): Promise<{ success: boolean }> {
    return this.taskService.deleteTask(this.resolveUserId(userIdHeader), taskId);
  }

  private resolveUserId(userIdHeader: string | string[] | undefined): string {
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
      throw new UnauthorizedException("缺少用户上下文");
    }

    return userId;
  }
}
