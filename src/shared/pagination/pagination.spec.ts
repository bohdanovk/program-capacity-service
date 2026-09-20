import {
  compareSortKeys,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  paginateSorted,
} from './pagination';

interface Row {
  id: string;
}

const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const keyOf = (row: Row): string[] => [row.id];

describe('keyset pagination', () => {
  it('walks a collection page by page and stops with a null cursor', () => {
    const first = paginateSorted({
      kind: 'rows',
      sorted: rows,
      request: { limit: 2, cursor: null },
      keyOf,
    });
    expect(first.items.map(keyOf).flat()).toEqual(['a', 'b']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = paginateSorted({
      kind: 'rows',
      sorted: rows,
      request: { limit: 2, cursor: first.nextCursor },
      keyOf,
    });
    expect(second.items.map(keyOf).flat()).toEqual(['c', 'd']);

    const third = paginateSorted({
      kind: 'rows',
      sorted: rows,
      request: { limit: 2, cursor: second.nextCursor },
      keyOf,
    });
    expect(third.items.map(keyOf).flat()).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  it('reports no next page when the last page is exactly full', () => {
    const page = paginateSorted({
      kind: 'rows',
      sorted: rows,
      request: { limit: 5, cursor: null },
      keyOf,
    });
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
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
