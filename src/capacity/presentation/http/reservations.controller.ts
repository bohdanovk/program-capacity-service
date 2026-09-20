import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { API_KEY_SECURITY_SCHEME } from '../../../auth/api-key.constants';
import { RequireScopes } from '../../../auth/decorators/require-scopes.decorator';
import { Scope } from '../../../auth/scope';
import { ErrorResponseDto } from '../../../common/http/error-response.dto';
import { toPageRequest } from '../../../common/http/pagination.dto';
import { ProgramQueries } from '../../application/queries/program-queries';
import { ReleaseReservationUseCase } from '../../application/use-cases/release-reservation.use-case';
import { ReserveCapacityUseCase } from '../../application/use-cases/reserve-capacity.use-case';
import {
  ListReservationsQueryDto,
  ProgramIdParamsDto,
  ReservationParamsDto,
} from './dto/params.dto';
import { ReservationDto, ReservationPageDto } from './dto/reservation.dto';
import { ReserveCapacityDto } from './dto/reserve-capacity.dto';

@ApiTags('Reservations')
@ApiSecurity(API_KEY_SECURITY_SCHEME)
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Missing or invalid API key' })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'API key lacks the required scope' })
@ApiNotFoundResponse({
  type: ErrorResponseDto,
  description: 'PROGRAM_NOT_FOUND or RESERVATION_NOT_FOUND',
})
@Controller('programs/:programId/reservations')
export class ReservationsController {
  constructor(
    private readonly reserveCapacity: ReserveCapacityUseCase,
    private readonly releaseReservation: ReleaseReservationUseCase,
    private readonly queries: ProgramQueries,
  ) {}

  @Get()
  @RequireScopes(Scope.Read)
  @ApiOperation({ summary: 'List reservations of a program, oldest first, one page at a time' })
  @ApiOkResponse({ type: ReservationPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid limit or cursor' })
  list(
    @Param() params: ProgramIdParamsDto,
    @Query() query: ListReservationsQueryDto,
  ): Promise<ReservationPageDto> {
    return this.queries.listReservations(params.programId, toPageRequest(query), query.status);
  }

  @Post()
  @RequireScopes(Scope.Write)
  @ApiOperation({
    summary: 'Reserve capacity for an approved invoice',
    description:
      'Converts the invoice amount into the program currency (rounded up) and reserves it. ' +
      'Idempotent on invoiceId: an identical repeat returns 200 with the existing reservation; ' +
      'a repeat with a different amount is rejected with 409 RESERVATION_CONFLICT.',
  })
  @ApiCreatedResponse({ type: ReservationDto, description: 'Reservation created' })
  @ApiOkResponse({
    type: ReservationDto,
    description: 'Identical reservation already existed (idempotent replay)',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Malformed body, unsupported currency or non-positive amount',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'INSUFFICIENT_CAPACITY, RESERVATION_CONFLICT or CONCURRENT_MODIFICATION (safe to retry)',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'UNSUPPORTED_CURRENCY_PAIR',
  })
  async reserve(
    @Param() params: ProgramIdParamsDto,
    @Body() body: ReserveCapacityDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReservationDto> {
    const outcome = await this.reserveCapacity.execute({
      programId: params.programId,
      invoiceId: body.invoiceId,
      invoiceAmount: body.invoiceAmount,
    });
    response.status(outcome.created ? HttpStatus.CREATED : HttpStatus.OK);
    return outcome.reservation;
  }

  @Get(':invoiceId')
  @RequireScopes(Scope.Read)
  @ApiOperation({ summary: 'Get one reservation' })
  @ApiOkResponse({ type: ReservationDto })
  get(@Param() params: ReservationParamsDto): Promise<ReservationDto> {
    return this.queries.getReservation(params.programId, params.invoiceId);
  }

  @Post(':invoiceId/release')
  @RequireScopes(Scope.Write)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release a reservation (invoice repaid)',
    description:
      'Gives the reserved capacity back. Idempotent: releasing twice returns the same released reservation.',
  })
  @ApiOkResponse({ type: ReservationDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'CONCURRENT_MODIFICATION (safe to retry)',
  })
  release(@Param() params: ReservationParamsDto): Promise<ReservationDto> {
    return this.releaseReservation.execute({
      programId: params.programId,
      invoiceId: params.invoiceId,
    });
  }
}
