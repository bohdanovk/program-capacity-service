import { Injectable } from '@nestjs/common';
import { Clock } from '../../domain/ports/clock';

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
