import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyRegistry } from './api-key.registry';

/** Registers API-key authentication for every HTTP route in the application. */
@Module({
  providers: [ApiKeyRegistry, { provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AuthModule {}
