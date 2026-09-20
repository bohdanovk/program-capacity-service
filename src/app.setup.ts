import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppConfig } from './config/app-config';
import { setupOpenApi } from './docs/openapi';

export const API_PREFIX = 'api/v1';

/** HTTP-level configuration shared by the production bootstrap and the e2e test harness. */
export function configureHttpApp(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);

  app.enableShutdownHooks();

  // Standard response headers: no X-Powered-By, nosniff, HSTS, frame denial, referrer policy.
  // Content-Security-Policy is off on purpose: the API serves JSON, and the one HTML page (the
  // OpenAPI UI) needs inline scripts and styles that a useful policy would have to allow anyway.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  if (config.get('swagger.enabled', { infer: true })) {
    setupOpenApi(app);
  }
}
