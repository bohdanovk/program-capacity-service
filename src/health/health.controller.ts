import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { AppConfig } from '../config/app-config';
import { HealthDto } from './health.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe (unauthenticated)' })
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      treasuryFeed: this.config.get('kafka.enabled', { infer: true }) ? 'enabled' : 'disabled',
      timestamp: new Date().toISOString(),
    };
  }
}
