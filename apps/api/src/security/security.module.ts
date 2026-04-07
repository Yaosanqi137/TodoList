import { Global, Module } from "@nestjs/common";
import { DataEncryptionService } from "./data-encryption.service";

@Global()
@Module({
  providers: [DataEncryptionService],
  exports: [DataEncryptionService]
})
export class SecurityModule {}
