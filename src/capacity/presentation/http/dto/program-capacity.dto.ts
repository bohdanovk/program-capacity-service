import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from './money.dto';

export class ProgramCapacityDto {
  @ApiProperty({ example: 'PRG-001' })
  programId!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({
    type: MoneyDto,
    description: 'Total credit limit as last set by treasury (or at creation)',
  })
  creditLimit!: MoneyDto;

  @ApiProperty({ type: MoneyDto, description: 'Sum of active reservations in program currency' })
  reserved!: MoneyDto;

  @ApiProperty({
    type: MoneyDto,
    description:
      'creditLimit - reserved, floored at zero. What a new reservation can consume right now.',
  })
  available!: MoneyDto;

  @ApiProperty({
    description: 'True when treasury lowered the limit below the amount already reserved.',
  })
  overCommitted!: boolean;

  @ApiProperty({ example: 12 })
  activeReservations!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 42,
    description: 'Sequence of the last treasury message applied to this program',
  })
  lastTreasurySequence!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-19T09:00:00.000Z' })
  lastReconciledAt!: string | null;

  @ApiProperty({ example: '2026-09-01T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-19T10:15:30.000Z' })
  updatedAt!: string;
}
