import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../../domain/reservation';
import { MoneyDto } from './money.dto';

export class ReservationDto {
  @ApiProperty({ example: 'PRG-001' })
  programId!: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  invoiceId!: string;

  @ApiProperty({ enum: ReservationStatus, example: ReservationStatus.Active })
  status!: ReservationStatus;

  @ApiProperty({ type: MoneyDto, description: 'Invoice face amount in the invoice currency' })
  invoiceAmount!: MoneyDto;

  @ApiProperty({ type: MoneyDto, description: 'Capacity consumed, in the program currency' })
  reservedAmount!: MoneyDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.085',
    description:
      'Rate applied (invoice currency to program currency). Null when the reservation was imported from a treasury snapshot.',
  })
  exchangeRate!: string | null;

  @ApiProperty({ example: '2026-09-19T10:15:30.000Z' })
  reservedAt!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  releasedAt!: string | null;

  @ApiProperty({ example: '2026-09-19T10:15:30.000Z' })
  updatedAt!: string;
}
