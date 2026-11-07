import { Global, Module } from '@nestjs/common';
import { type Env, validateEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
