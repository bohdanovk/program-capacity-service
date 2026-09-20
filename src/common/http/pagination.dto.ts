import { Type as ClassType } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageRequest } from '../../shared/pagination/pagination';

/** Query parameters accepted by every list endpoint. */
export class PageQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Maximum number of items in the page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({
    description: '`nextCursor` from the previous page. Opaque; omit for the first page.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  cursor?: string;
}

export function toPageRequest(query: PageQueryDto): PageRequest {
  return { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: query.cursor ?? null };
}

export interface PageDto<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

/**
 * Builds a concrete, OpenAPI-documented page class for an item type:
 * `class ProgramPageDto extends PageDtoOf(ProgramDto, 'ProgramPage') {}`.
 */
export function PageDtoOf<T>(itemType: ClassType<T>, schemaName: string): ClassType<PageDto<T>> {
  class PageOf implements PageDto<T> {
    @ApiProperty({ type: [itemType] })
    readonly items!: readonly T[];

    @ApiProperty({
      type: String,
      nullable: true,
      description: 'Pass as `?cursor=` to fetch the next page; null on the last page',
    })
    readonly nextCursor!: string | null;

    @ApiProperty({ example: DEFAULT_PAGE_SIZE })
    readonly limit!: number;
  }
  Object.defineProperty(PageOf, 'name', { value: schemaName });

  return PageOf;
}
