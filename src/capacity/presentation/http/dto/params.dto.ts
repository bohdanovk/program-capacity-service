import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { PageQueryDto } from '../../../../common/http/pagination.dto';
import { IDENTIFIER_PATTERN } from '../../../../common/validation/patterns';
import { ReservationStatus } from '../../../domain/reservation';

export class ProgramIdParamsDto {
  @ApiProperty({ example: 'PRG-001' })
  @IsString()
  @Matches(IDENTIFIER_PATTERN, { message: 'programId must be 1-64 chars of [A-Za-z0-9._-]' })
  programId!: string;
}

export class ReservationParamsDto extends ProgramIdParamsDto {
  @ApiProperty({ example: 'INV-2026-0001' })
  @IsString()
  @Matches(IDENTIFIER_PATTERN, { message: 'invoiceId must be 1-64 chars of [A-Za-z0-9._-]' })
  invoiceId!: string;
}

export class ListReservationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReservationStatus, description: 'Filter by reservation status' })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;
}
