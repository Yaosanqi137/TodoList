import { IsEmail } from "class-validator";

export class SendEmailCodeDto {
  @IsEmail()
  email!: string;
}
