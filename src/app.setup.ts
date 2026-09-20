import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './config/app-config';
import { setupOpenApi } from './docs/openapi';

export const API_PREFIX = 'api/v1';

/** HTTP-level configuration shared by the production bootstrap and the e2e test harness. */
export function configureHttpApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);

  app.enableShutdownHooks();
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  if (config.get('swagger.enabled', { infer: true })) {
    setupOpenApi(app);
  }
}
