import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/app-config';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import { InMemoryProgramRepository } from './in-memory-program.repository';
import { PostgresProgramRepository } from './postgres-program.repository';

@Module({
  providers: [
    {
      provide: PROGRAM_REPOSITORY,
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { store, databaseUrl } = config.get('persistence', { infer: true });
        if (store === 'memory') {
          return new InMemoryProgramRepository();
        }
        if (databaseUrl === undefined) {
          throw new Error('DATABASE_URL is required for the postgres store');
        }
        return new PostgresProgramRepository(databaseUrl);
      },
      inject: [ConfigService],
    },
  ],
  exports: [PROGRAM_REPOSITORY],
})
export class PersistenceModule {}
