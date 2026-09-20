import { ConsoleLogger, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { API_PREFIX, configureHttpApp } from './app.setup';
import { treasuryKafkaOptions } from './capacity/presentation/kafka/treasury-kafka.options';
import { AppConfig, LOG_LEVELS, LogLevel } from './config/app-config';
import { OPENAPI_PATH } from './docs/openapi';

/** The configured level and every level more severe than it. */
function enabledLevels(minimum: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(minimum));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');

  app.useLogger(
    new ConsoleLogger({
      json: config.get('env', { infer: true }) === 'production',
      logLevels: enabledLevels(config.get('logLevel', { infer: true })),
    }),
  );
  configureHttpApp(app);

  const kafka = config.get('kafka', { infer: true });
  if (kafka.enabled) {
    app.connectMicroservice<MicroserviceOptions>(treasuryKafkaOptions(kafka), {
      inheritAppConfig: false,
    });
    await app.startAllMicroservices();
    logger.log(
      `Treasury consumer connected to ${kafka.brokers.join(',')} (group ${kafka.groupId})`,
    );
  } else {
    logger.warn('Treasury Kafka consumer disabled (KAFKA_ENABLED=false)');
  }

  await app.listen(config.get('port', { infer: true }));

  // The address the server actually bound to, as reported by the HTTP adapter.
  const url = await app.getUrl();
  logger.log(`HTTP API listening on ${url}/${API_PREFIX}`);
  if (config.get('swagger.enabled', { infer: true })) {
    logger.log(`OpenAPI docs at ${url}/${OPENAPI_PATH}`);
  }
}

bootstrap().catch((error: unknown) => {
  // Logger may not be wired yet; console is the reliable channel for a start-up failure.
  // eslint-disable-next-line no-console
  console.error('Fatal: application failed to start', error);
  process.exit(1);
});
