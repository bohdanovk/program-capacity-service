import { DomainError } from '../domain/domain-error';

/**
 * Keyset ("cursor") pagination, shared by every list in the service.
 *
 * A page is `limit` items after an opaque cursor, ordered by a sort key. Compared with
 * offset paging it is stable while rows are inserted, costs the same for page 1 and page
 * 1000, and maps one to one onto `WHERE key > :cursor ORDER BY key LIMIT :limit + 1` in SQL.
 * Clients only ever see `nextCursor`; what it encodes is this service's business.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  readonly limit: number;
  /** `nextCursor` of a previous page, or null for the first page. */
  readonly cursor: string | null;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Cursor for the following page; null when this is the last one. */
  readonly nextCursor: string | null;
  readonly limit: number;
}

/** Sort key of an item: strings compared position by position, all ascending. */
export type SortKey = readonly string[];

export class InvalidCursorError extends DomainError {
  constructor() {
    super('INVALID_CURSOR', 'INVALID_INPUT', 'The cursor is not one this service issued');
  }
}

/** Encodes a cursor for one kind of list; decoding with another kind fails. */
export function encodeCursor(kind: string, key: SortKey): string {
  return Buffer.from(JSON.stringify([kind, ...key]), 'utf8').toString('base64url');
}

export function decodeCursor(kind: string, cursor: string): SortKey {
  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }

  if (!Array.isArray(decoded) || !decoded.every((part) => typeof part === 'string')) {
    throw new InvalidCursorError();
  }
  const [cursorKind, ...key] = decoded;
  if (cursorKind !== kind || key.length === 0) {
    throw new InvalidCursorError();
  }

  return key;
}

export function compareSortKeys(a: SortKey, b: SortKey): number {
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? '';
    const right = b[i] ?? '';
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
  }

  return a.length - b.length;
}

export interface PaginateInput<T> {
  readonly kind: string;
  /** Items already sorted ascending by `keyOf` (use {@link compareSortKeys}). */
  readonly sorted: readonly T[];
  readonly request: PageRequest;
  readonly keyOf: (item: T) => SortKey;
}

/**
 * Pages through an in-memory collection. One extra item is inspected to learn whether a
 * next page exists, so no count is needed. This is what a database adapter replaces with
 * the equivalent keyset query.
 */
export function paginateSorted<T>({ kind, sorted, request, keyOf }: PaginateInput<T>): Page<T> {
  const after = request.cursor === null ? null : decodeCursor(kind, request.cursor);
  const candidates =
    after === null ? sorted : sorted.filter((item) => compareSortKeys(keyOf(item), after) > 0);
  const items = candidates.slice(0, request.limit);
  const last = items.at(-1);
  const hasMore = candidates.length > request.limit && last !== undefined;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(kind, keyOf(last)) : null,
    limit: request.limit,
  };
}
