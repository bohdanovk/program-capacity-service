import { compareSortKeys, SortKey } from '../../../shared/pagination/pagination';
import { OrderedIndex, WorkMeter } from './ordered-index';

type Entry = readonly [string];
const entry = (n: number): Entry => [String(n).padStart(8, '0')];
const keyOf = (item: Entry): SortKey => item;

/** Deterministic pseudo-random numbers (a linear congruential generator), so failures replay. */
function randomSequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state;
  };
}

function allPages(index: OrderedIndex<Entry>, limit: number): Entry[] {
  const seen: Entry[] = [];
  let cursor: string | null = null;
  do {
    const page = index.page('entries', { limit, cursor });
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return seen;
}

describe('OrderedIndex', () => {
  it('stays in order through any mix of inserts and removals', () => {
    const index = new OrderedIndex<Entry>(keyOf);
    const reference = new Set<number>();
    const next = randomSequence(42);

    for (let i = 0; i < 20_000; i += 1) {
      const n = next() % 5_000;
      if (next() % 3 === 0) {
        index.remove(entry(n));
        reference.delete(n);
      } else {
        index.insert(entry(n));
        reference.add(n);
      }
    }

    const expected = [...reference].sort((a, b) => a - b).map(entry);
    expect([...index.values()]).toEqual(expected);
    expect(allPages(index, 37)).toEqual(expected);
  });

  it('can be emptied completely and filled again', () => {
    const index = new OrderedIndex<Entry>(keyOf);
    for (let n = 0; n < 1_000; n += 1) {
      index.insert(entry(n));
    }
    for (let n = 0; n < 1_000; n += 1) {
      index.remove(entry(n));
    }
    expect([...index.values()]).toEqual([]);

    index.insert(entry(7));
    index.insert(entry(3));
    expect([...index.values()]).toEqual([entry(3), entry(7)]);
  });

  it('resumes after a cursor whose entry has since been removed', () => {
    const index = new OrderedIndex<Entry>(keyOf);
    for (let n = 0; n < 500; n += 1) {
      index.insert(entry(n));
    }
    const first = index.page('entries', { limit: 100, cursor: null });

    for (let n = 90; n < 110; n += 1) {
      index.remove(entry(n));
    }
    const second = index.page('entries', { limit: 3, cursor: first.nextCursor });

    expect(second.items).toEqual([entry(110), entry(111), entry(112)]);
  });

  it('replaces the entry when a key is inserted twice', () => {
    const index = new OrderedIndex<{ key: SortKey; label: string }>((item) => item.key);
    index.insert({ key: ['a'], label: 'first' });
    index.insert({ key: ['a'], label: 'second' });

    expect([...index.values()].map((item) => item.label)).toEqual(['second']);
  });

  it.each([
    { after: null, count: 2, expected: [2, 4] },
    { after: 1, count: 2, expected: [2, 4] },
    { after: 2, count: 2, expected: [4, 6] },
    { after: 3, count: 2, expected: [4, 6] },
    { after: 4, count: 10, expected: [6] },
    { after: 6, count: 2, expected: [] },
    { after: 7, count: 2, expected: [] },
    { after: null, count: 0, expected: [] },
    { after: 2, count: -1, expected: [] },
  ])('reads at most $count entries strictly after $after', ({ after, count, expected }) => {
    const index = new OrderedIndex<Entry>(keyOf);
    for (const n of [2, 4, 6]) {
      index.insert(entry(n));
    }

    expect(index.entriesAfter(after === null ? null : entry(after), count)).toEqual(
      expected.map(entry),
    );
  });

  it('returns an empty page from an empty index, with or without a cursor', () => {
    const index = new OrderedIndex<Entry>(keyOf);

    expect(index.page('entries', { limit: 2, cursor: null })).toEqual({
      items: [],
      nextCursor: null,
      limit: 2,
    });
    expect(index.entriesAfter(entry(2), 2)).toEqual([]);
  });

  /**
   * The adapter must seek to a cursor and stop once it has a page, even deep in a large
   * index. Comparisons and visited entries expose scans; internal tree moves are not counted.
   */
  it('bounds comparisons and visited entries on a large index', () => {
    const meter: WorkMeter = { units: 0 };
    const index = new OrderedIndex<Entry>(keyOf, meter);
    const size = 100_000;
    for (let n = 0; n < size; n += 1) {
      index.insert(entry(2 * n));
    }

    const costs: number[] = [];
    const measure = (operation: () => void): void => {
      const before = meter.units;
      operation();
      costs.push(meter.units - before);
    };
    const next = randomSequence(7);
    for (let i = 0; i < 1_000; i += 1) {
      measure(() => {
        index.remove(entry(2 * i)); // the oldest entry, every time
      });
      measure(() => {
        index.insert(entry(2 * (next() % size) + 1)); // anywhere in between
      });
      measure(() => {
        index.remove(entry(2 * (next() % size)));
      });
      measure(() => index.page('entries', { limit: 50, cursor: null }));
      measure(() => index.entriesAfter(entry(size), 50));
    }

    // Far below scanning the collection, with room for tree maintenance and page reads.
    expect(Math.max(...costs)).toBeLessThan(1_000);
    expect(costs.reduce((sum, cost) => sum + cost, 0) / costs.length).toBeLessThan(60);
  });

  it('orders by the shared sort-key comparison', () => {
    const index = new OrderedIndex<SortKey>((key) => key);
    const keys: SortKey[] = [
      ['2026-09-19T10:01:00.000Z', 'INV-B'],
      ['2026-09-19T10:00:00.000Z', 'INV-Z'],
      ['2026-09-19T10:01:00.000Z', 'INV-A'],
    ];
    keys.forEach((key) => {
      index.insert(key);
    });

    expect([...index.values()]).toEqual([...keys].sort(compareSortKeys));
  });
});
