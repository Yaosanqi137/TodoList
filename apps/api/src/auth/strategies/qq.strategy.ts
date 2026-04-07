import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-oauth2";

@Injectable()
export class QqStrategy extends PassportStrategy(Strategy, "qq") {
  constructor(configService: ConfigService) {
    super({
      authorizationURL:
        configService.get<string>("OAUTH_QQ_AUTH_URL") ?? "https://graph.qq.com/oauth2.0/authorize",
      tokenURL:
        configService.get<string>("OAUTH_QQ_TOKEN_URL") ?? "https://graph.qq.com/oauth2.0/token",
      clientID: configService.get<string>("OAUTH_QQ_CLIENT_ID") ?? "qq-client-id",
      clientSecret: configService.get<string>("OAUTH_QQ_CLIENT_SECRET") ?? "qq-client-secret",
      callbackURL:
        configService.get<string>("OAUTH_QQ_CALLBACK_URL") ??
        "http://localhost:3000/auth/oauth/qq/callback",
      scope: ["get_user_info"]
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string
  ): Promise<{ provider: "qq"; accessToken: string; refreshToken: string }> {
    return {
      provider: "qq",
      accessToken,
      refreshToken
    };
  }
}
