import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const bodyLimit = process.env.API_BODY_LIMIT ?? "8mb";

  app.useBodyParser("json", { limit: bodyLimit });
  app.useBodyParser("urlencoded", {
    extended: true,
    limit: bodyLimit
  });
  app.enableCors({
    origin: true,
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  await app.listen(3000);
}

void bootstrap();
