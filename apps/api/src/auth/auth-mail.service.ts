import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";

type MailRuntimeConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromAddress: string;
};

@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);
  private cachedConfig: MailRuntimeConfig | null = null;
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async sendLoginCode(email: string, code: string, ttlSeconds: number): Promise<void> {
    const config = this.getRuntimeConfig();
    const transporter = this.getTransporter(config);

    try {
      await transporter.sendMail({
        from: this.resolveFromField(config),
        to: email,
        subject: "TodoList 登录验证码",
        text: `你的验证码是 ${code}，${ttlSeconds} 秒内有效。`,
        html: `<p>你的验证码是 <strong>${code}</strong>，${ttlSeconds} 秒内有效。</p>`
      });
    } catch (error) {
      this.logger.error(
        `验证码邮件发送失败: ${email}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new ServiceUnavailableException("验证码邮件发送失败，请稍后重试");
    }
  }

  private getTransporter(config: MailRuntimeConfig): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });

    return this.transporter;
  }

  private getRuntimeConfig(): MailRuntimeConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const host = this.getRequiredString("MAIL_SMTP_HOST");
    const port = this.getRequiredNumber("MAIL_SMTP_PORT");
    const secure = this.getBoolean("MAIL_SMTP_SECURE", port === 465);
    const user = this.getRequiredString("MAIL_SMTP_USER");
    const pass = this.getRequiredString("MAIL_SMTP_PASS");
    const fromName = this.configService.get<string>("MAIL_FROM_NAME")?.trim() || "TodoList";
    const fromAddress = this.configService.get<string>("MAIL_FROM_ADDRESS")?.trim() || user;

    const config: MailRuntimeConfig = {
      host,
      port,
      secure,
      user,
      pass,
      fromName,
      fromAddress
    };

    this.cachedConfig = config;
    return config;
  }

  private getRequiredString(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new InternalServerErrorException(`邮件配置缺失: ${key}`);
    }

    return value;
  }

  private getRequiredNumber(key: string): number {
    const rawValue = this.configService.get<string>(key)?.trim();
    if (!rawValue) {
      throw new InternalServerErrorException(`邮件配置缺失: ${key}`);
    }

    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      throw new InternalServerErrorException(`邮件配置格式错误: ${key}`);
    }

    return parsedValue;
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const rawValue = this.configService.get<string>(key);
    if (!rawValue) {
      return fallback;
    }

    const normalizedValue = rawValue.trim().toLowerCase();
    return normalizedValue === "true" || normalizedValue === "1";
  }

  private resolveFromField(config: MailRuntimeConfig): string {
    const sanitizedName = config.fromName.replace(/"/g, "");
    return `"${sanitizedName}" <${config.fromAddress}>`;
  }
}
