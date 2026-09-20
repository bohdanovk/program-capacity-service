import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, Matches, ValidateNested } from 'class-validator';
import { IDENTIFIER_PATTERN } from '../../../../common/validation/patterns';
import { MoneyDto } from './money.dto';

export class CreateProgramDto {
  @ApiProperty({ example: 'PRG-001', description: 'Caller-assigned program identifier' })
  @IsString()
  @Matches(IDENTIFIER_PATTERN, { message: 'programId must be 1-64 chars of [A-Za-z0-9._-]' })
  programId!: string;

  @ApiProperty({
    type: MoneyDto,
    description: 'Total credit limit. Its currency becomes the program currency.',
  })
  @ValidateNested()
  @Type(() => MoneyDto)
  creditLimit!: MoneyDto;
}
