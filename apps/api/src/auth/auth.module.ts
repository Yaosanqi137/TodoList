import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthMailService } from "./auth-mail.service";
import { AuthService } from "./auth.service";
import { GithubStrategy } from "./strategies/github.strategy";
import { QqStrategy } from "./strategies/qq.strategy";
import { WechatStrategy } from "./strategies/wechat.strategy";

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresInSeconds = Number(configService.get("AUTH_ACCESS_EXPIRES_IN_SECONDS") ?? 900);

        return {
          secret: configService.get<string>("AUTH_ACCESS_SECRET") ?? "dev-access-secret",
          signOptions: {
            expiresIn: expiresInSeconds
          }
        };
      }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthMailService, GithubStrategy, QqStrategy, WechatStrategy]
})
export class AuthModule {}
