import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import {
  CURRENCY_CODE_PATTERN,
  DECIMAL_AMOUNT_PATTERN,
} from '../../../../common/validation/patterns';

export class MoneyDto {
  @ApiProperty({
    example: '1250000.00',
    description:
      'Plain decimal string. Fraction digits may not exceed the currency minor units (2 for USD, 0 for JPY). Never a float.',
  })
  @IsString()
  @Matches(DECIMAL_AMOUNT_PATTERN, {
    message: 'amount must be a plain non-negative decimal string',
  })
  amount!: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 code' })
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency!: string;
}
