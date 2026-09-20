import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Uniform error envelope returned by every endpoint. */
export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({
    example: 'INSUFFICIENT_CAPACITY',
    description: 'Stable machine-readable code. Branch on this, not on the message.',
  })
  code!: string;

  @ApiProperty({
    example: 'Program "PRG-001" cannot reserve 250000.00 USD: only 120000.00 USD is available',
  })
  message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { programId: 'PRG-001', requested: '250000.00 USD', available: '120000.00 USD' },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '3f1c2a2e-9d1a-4c1b-8e77-0b1f3d2a9c11' })
  requestId!: string;

  @ApiProperty({ example: '2026-09-19T10:15:30.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/programs/PRG-001/reservations' })
  path!: string;
}
