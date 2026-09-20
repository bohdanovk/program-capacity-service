import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 42 })
  uptimeSeconds!: number;

  @ApiProperty({
    enum: ['enabled', 'disabled'],
    description: 'Whether the treasury Kafka consumer is configured for this instance.',
  })
  treasuryFeed!: 'enabled' | 'disabled';

  @ApiProperty({ example: '2026-09-19T10:15:30.000Z' })
  timestamp!: string;
}
