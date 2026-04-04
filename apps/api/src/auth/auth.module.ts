import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [
    ConfigModule,
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
  providers: [AuthService]
})
export class AuthModule {}
