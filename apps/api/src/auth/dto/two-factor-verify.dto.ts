import { IsEmail, IsString, Length, Matches } from "class-validator";

export class TwoFactorVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  token!: string;
}
