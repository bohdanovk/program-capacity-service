import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/app-config';
import { FX_RATE_PROVIDER } from '../../domain/ports/fx-rate-provider';
import { StaticFxRateProvider } from './static-fx-rate.provider';

/** Binds the FxRateProvider port to configuration-driven static rates. */
@Module({
  providers: [
    {
      provide: FX_RATE_PROVIDER,
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new StaticFxRateProvider(config.get('fx.rates', { infer: true })),
      inject: [ConfigService],
    },
  ],
  exports: [FX_RATE_PROVIDER],
})
export class StaticFxModule {}
