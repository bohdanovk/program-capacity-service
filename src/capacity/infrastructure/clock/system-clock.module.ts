import { Module } from '@nestjs/common';
import { CLOCK } from '../../domain/ports/clock';
import { SystemClock } from './system-clock';

@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class SystemClockModule {}
