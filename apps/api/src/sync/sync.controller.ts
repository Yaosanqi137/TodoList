import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from "@nestjs/common";
import { SyncPullQueryDto } from "./dto/sync-pull.dto";
import { SyncPushDto } from "./dto/sync-push.dto";
import { SyncPullResponse, SyncPushResponse, SyncService } from "./sync.service";

@Controller("sync")
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get("pull")
  async pullOperations(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Query() query: SyncPullQueryDto
  ): Promise<SyncPullResponse> {
    return this.syncService.pullOperations(this.resolveUserId(userIdHeader), query);
  }

  @Post("push")
  async pushOperations(
    @Headers("x-user-id") userIdHeader: string | string[] | undefined,
    @Body() body: SyncPushDto
  ): Promise<SyncPushResponse> {
    return this.syncService.pushOperations(this.resolveUserId(userIdHeader), body);
  }

  private resolveUserId(userIdHeader: string | string[] | undefined): string {
    const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
    if (!userId) {
      throw new UnauthorizedException("缺少用户上下文");
    }

    return userId;
  }
}
