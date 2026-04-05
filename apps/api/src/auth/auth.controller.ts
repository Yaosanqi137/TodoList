import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { EmailLoginDto } from "./dto/email-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SendEmailCodeDto } from "./dto/send-email-code.dto";
import { TwoFactorEnrollDto } from "./dto/two-factor-enroll.dto";
import { TwoFactorVerifyDto } from "./dto/two-factor-verify.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("email/send-code")
  async sendEmailCode(
    @Body() body: SendEmailCodeDto
  ): Promise<{ success: boolean; expiresInSeconds: number }> {
    return this.authService.sendEmailCode(body.email);
  }

  @Post("email/login")
  async loginWithEmailCode(@Body() body: EmailLoginDto): Promise<{
    accessToken: string;
    tokenType: "Bearer";
    expiresInSeconds: number;
    refreshToken: string;
    refreshExpiresInSeconds: number;
    user: { id: string; email: string };
  }> {
    return this.authService.loginWithEmailCode(body.email, body.code);
  }

  @Post("token/refresh")
  async refreshTokens(@Body() body: RefreshTokenDto): Promise<{
    accessToken: string;
    tokenType: "Bearer";
    expiresInSeconds: number;
    refreshToken: string;
    refreshExpiresInSeconds: number;
    user: { id: string; email: string };
  }> {
    return this.authService.refreshTokens(body.refreshToken);
  }

  @Post("token/revoke")
  async revokeRefreshToken(@Body() body: RefreshTokenDto): Promise<{ success: boolean }> {
    return this.authService.revokeRefreshToken(body.refreshToken);
  }

  @Post("2fa/enroll")
  async enrollTwoFactor(@Body() body: TwoFactorEnrollDto): Promise<{
    userId: string;
    secret: string;
    otpauthUrl: string;
    enabled: boolean;
  }> {
    return this.authService.enrollTwoFactor(body.email);
  }

  @Post("2fa/verify")
  async verifyTwoFactor(
    @Body() body: TwoFactorVerifyDto
  ): Promise<{ success: boolean; enabled: boolean }> {
    return this.authService.verifyTwoFactor(body.email, body.token);
  }

  @Get("oauth/github")
  @UseGuards(AuthGuard("github"))
  githubLogin(): void {}

  @Get("oauth/github/callback")
  @UseGuards(AuthGuard("github"))
  githubCallback(@Req() req: { user: unknown }): {
    success: boolean;
    provider: "github";
    profile: unknown;
  } {
    return {
      success: true,
      provider: "github",
      profile: req.user
    };
  }

  @Get("oauth/qq")
  @UseGuards(AuthGuard("qq"))
  qqLogin(): void {}

  @Get("oauth/qq/callback")
  @UseGuards(AuthGuard("qq"))
  qqCallback(@Req() req: { user: unknown }): {
    success: boolean;
    provider: "qq";
    profile: unknown;
  } {
    return {
      success: true,
      provider: "qq",
      profile: req.user
    };
  }

  @Get("oauth/wechat")
  @UseGuards(AuthGuard("wechat"))
  wechatLogin(): void {}

  @Get("oauth/wechat/callback")
  @UseGuards(AuthGuard("wechat"))
  wechatCallback(@Req() req: { user: unknown }): {
    success: boolean;
    provider: "wechat";
    profile: unknown;
  } {
    return {
      success: true,
      provider: "wechat",
      profile: req.user
    };
  }
}
