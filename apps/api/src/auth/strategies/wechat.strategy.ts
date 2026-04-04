import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-oauth2";

@Injectable()
export class WechatStrategy extends PassportStrategy(Strategy, "wechat") {
  constructor(configService: ConfigService) {
    super({
      authorizationURL:
        configService.get<string>("OAUTH_WECHAT_AUTH_URL") ??
        "https://open.weixin.qq.com/connect/qrconnect",
      tokenURL:
        configService.get<string>("OAUTH_WECHAT_TOKEN_URL") ??
        "https://api.weixin.qq.com/sns/oauth2/access_token",
      clientID: configService.get<string>("OAUTH_WECHAT_CLIENT_ID") ?? "wechat-client-id",
      clientSecret:
        configService.get<string>("OAUTH_WECHAT_CLIENT_SECRET") ?? "wechat-client-secret",
      callbackURL:
        configService.get<string>("OAUTH_WECHAT_CALLBACK_URL") ??
        "http://localhost:3000/auth/oauth/wechat/callback",
      scope: ["snsapi_login"]
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string
  ): Promise<{ provider: "wechat"; accessToken: string; refreshToken: string }> {
    return {
      provider: "wechat",
      accessToken,
      refreshToken
    };
  }
}
