import { IsEmail } from "class-validator";

export class TwoFactorEnrollDto {
  @IsEmail()
  email!: string;
}
