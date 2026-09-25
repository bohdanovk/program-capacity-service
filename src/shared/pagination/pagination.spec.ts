import {
  compareSortKeys,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  Page,
  PageRequest,
  paginate,
  SortKey,
} from './pagination';

interface Row {
  id: string;
}

const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const keyOf = (row: Row): string[] => [row.id];
const itemsAfter = (after: SortKey | null, count: number): Row[] =>
  rows.filter((row) => after === null || compareSortKeys(keyOf(row), after) > 0).slice(0, count);

function page(request: PageRequest): Page<Row> {
  return paginate({ kind: 'rows', request, keyOf, itemsAfter });
}

describe('keyset pagination', () => {
  it('walks a collection page by page and stops with a null cursor', () => {
    const first = page({ limit: 2, cursor: null });
    expect(first.items.map(keyOf).flat()).toEqual(['a', 'b']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = page({ limit: 2, cursor: first.nextCursor });
    expect(second.items.map(keyOf).flat()).toEqual(['c', 'd']);

    const third = page({ limit: 2, cursor: second.nextCursor });
    expect(third.items.map(keyOf).flat()).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  it('reports no next page when the last page is exactly full', () => {
    const full = page({ limit: 5, cursor: null });
    expect(full.items).toHaveLength(5);
    expect(full.nextCursor).toBeNull();
  });

  it('round-trips composite keys and rejects cursors it did not issue', () => {
    const cursor = encodeCursor('reservations', ['2026-09-19T10:00:00.000Z', 'INV/1 ü']);
    expect(decodeCursor('reservations', cursor)).toEqual(['2026-09-19T10:00:00.000Z', 'INV/1 ü']);

    expect(() => decodeCursor('programs', cursor)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('rows', 'not-a-cursor')).toThrow(InvalidCursorError);
    expect(() => decodeCursor('rows', Buffer.from('{"a":1}').toString('base64url'))).toThrow(
      InvalidCursorError,
    );
  });

  it('compares keys position by position', () => {
    expect(compareSortKeys(['2026-01-01', 'b'], ['2026-01-01', 'a'])).toBeGreaterThan(0);
    expect(compareSortKeys(['2025-12-31', 'z'], ['2026-01-01', 'a'])).toBeLessThan(0);
    expect(compareSortKeys(['x'], ['x'])).toBe(0);
  });
});
