import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Profile, Strategy } from "passport-github2";

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, "github") {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>("OAUTH_GITHUB_CLIENT_ID") ?? "github-client-id",
      clientSecret:
        configService.get<string>("OAUTH_GITHUB_CLIENT_SECRET") ?? "github-client-secret",
      callbackURL:
        configService.get<string>("OAUTH_GITHUB_CALLBACK_URL") ??
        "http://localhost:3000/auth/oauth/github/callback",
      scope: ["user:email"]
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile
  ): Promise<{ provider: "github"; accessToken: string; refreshToken: string; profile: Profile }> {
    return {
      provider: "github",
      accessToken,
      refreshToken,
      profile
    };
  }
}
