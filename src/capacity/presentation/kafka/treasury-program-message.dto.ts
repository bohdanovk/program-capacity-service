import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CURRENCY_CODE_PATTERN,
  DECIMAL_AMOUNT_PATTERN,
  IDENTIFIER_PATTERN,
} from '../../../common/validation/patterns';

/** Message kinds published by treasury on the program-capacity topic. */
export enum TreasuryMessageType {
  /** The program's credit limit changed (also announces programs we have not seen yet). */
  ProgramLimitChanged = 'ProgramLimitChanged',
  /** Periodic full-state snapshot: limit plus every active reservation as treasury sees it. */
  ProgramReconciled = 'ProgramReconciled',
}

export class TreasurySnapshotReservationDto {
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  invoiceId!: string;

  @IsString()
  @Matches(DECIMAL_AMOUNT_PATTERN)
  invoiceAmount!: string;

  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  invoiceCurrency!: string;

  /** Capacity consumed, in the program currency. */
  @IsString()
  @Matches(DECIMAL_AMOUNT_PATTERN)
  reservedAmount!: string;
}

/**
 * Wire format of `treasury.program-capacity.v1` messages (JSON value, key = programId).
 * Documented for producers in docs/treasury-kafka-contract.md.
 */
export class TreasuryProgramMessageDto {
  @IsEnum(TreasuryMessageType)
  type!: TreasuryMessageType;

  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  programId!: string;

  /** Per-program, strictly increasing. Messages at or below the last applied sequence are ignored. */
  @IsInt()
  @Min(0)
  sequence!: number;

  /** ISO 8601 instant the state became true in treasury. For snapshots this is the "as of" time. */
  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsString()
  @Matches(CURRENCY_CODE_PATTERN)
  currency!: string;

  @IsString()
  @Matches(DECIMAL_AMOUNT_PATTERN)
  creditLimit!: string;

  /** Required for ProgramReconciled; ignored otherwise. */
  @ValidateIf(
    (message: TreasuryProgramMessageDto) => message.type === TreasuryMessageType.ProgramReconciled,
  )
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreasurySnapshotReservationDto)
  activeReservations?: TreasurySnapshotReservationDto[];
}
