import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { EmailLoginDto } from "./dto/email-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SendEmailCodeDto } from "./dto/send-email-code.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("email/send-code")
  async sendEmailCode(
    @Body() body: SendEmailCodeDto
  ): Promise<{ success: boolean; expiresInSeconds: number; debugCode: string }> {
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
}
