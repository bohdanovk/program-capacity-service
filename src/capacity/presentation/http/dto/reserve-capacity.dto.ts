import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, Matches, ValidateNested } from 'class-validator';
import { IDENTIFIER_PATTERN } from '../../../../common/validation/patterns';
import { MoneyDto } from './money.dto';

export class ReserveCapacityDto {
  @ApiProperty({
    example: 'INV-2026-0001',
    description:
      'Invoice identifier. Acts as the idempotency key: repeating the request with the same amount returns the existing reservation.',
  })
  @IsString()
  @Matches(IDENTIFIER_PATTERN, { message: 'invoiceId must be 1-64 chars of [A-Za-z0-9._-]' })
  invoiceId!: string;

  @ApiProperty({
    type: MoneyDto,
    description:
      'Invoice face amount in its own currency. Converted to the program currency at the configured rate, rounded up.',
  })
  @ValidateNested()
  @Type(() => MoneyDto)
  invoiceAmount!: MoneyDto;
}
