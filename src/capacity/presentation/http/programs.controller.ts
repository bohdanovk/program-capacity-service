import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
} from '@nestjs/swagger';
import { API_KEY_SECURITY_SCHEME } from '../../../auth/api-key.constants';
import { RequireScopes } from '../../../auth/decorators/require-scopes.decorator';
import { Scope } from '../../../auth/scope';
import { ErrorResponseDto } from '../../../common/http/error-response.dto';
import { PageQueryDto, toPageRequest } from '../../../common/http/pagination.dto';
import { ProgramQueries } from '../../application/queries/program-queries';
import { CreateProgramUseCase } from '../../application/use-cases/create-program.use-case';
import { CreateProgramDto } from './dto/create-program.dto';
import { ProgramIdParamsDto } from './dto/params.dto';
import { ProgramCapacityDto, ProgramCapacityPageDto } from './dto/program-capacity.dto';

@ApiTags('Programs')
@ApiSecurity(API_KEY_SECURITY_SCHEME)
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Missing or invalid API key' })
@ApiForbiddenResponse({ type: ErrorResponseDto, description: 'API key lacks the required scope' })
@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly createProgram: CreateProgramUseCase,
    private readonly queries: ProgramQueries,
  ) {}

  @Get()
  @RequireScopes(Scope.Read)
  @ApiOperation({ summary: 'List programs with their current capacity, one page at a time' })
  @ApiOkResponse({ type: ProgramCapacityPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid limit or cursor' })
  list(@Query() query: PageQueryDto): Promise<ProgramCapacityPageDto> {
    return this.queries.listPrograms(toPageRequest(query));
  }

  @Post()
  @RequireScopes(Scope.Write)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a program',
    description:
      'Bootstraps a program with a credit limit. Treasury stays the system of record: any later treasury message for this program overrides the limit set here.',
  })
  @ApiCreatedResponse({ type: ProgramCapacityDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Malformed body or unsupported currency',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'PROGRAM_ALREADY_EXISTS' })
  create(@Body() body: CreateProgramDto): Promise<ProgramCapacityDto> {
    return this.createProgram.execute({ programId: body.programId, creditLimit: body.creditLimit });
  }

  @Get(':programId')
  @RequireScopes(Scope.Read)
  @ApiOperation({ summary: 'Current capacity of a program (limit, reserved, available)' })
  @ApiOkResponse({ type: ProgramCapacityDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'PROGRAM_NOT_FOUND' })
  get(@Param() params: ProgramIdParamsDto): Promise<ProgramCapacityDto> {
    return this.queries.getProgramCapacity(params.programId);
  }
}
