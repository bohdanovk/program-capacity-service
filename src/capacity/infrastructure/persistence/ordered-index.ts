import BTree from 'sorted-btree';
import {
  compareSortKeys,
  Page,
  PageRequest,
  paginate,
  SortKey,
} from '../../../shared/pagination/pagination';

/** Counts key comparisons and entries visited, excluding the library's internal moves. */
export interface WorkMeter {
  units: number;
}

/** Adapts sorted-btree to the service's sort keys and exclusive cursor pagination. */
export class OrderedIndex<T> {
  private readonly tree: BTree<SortKey, T>;

  constructor(
    private readonly keyOf: (entry: T) => SortKey,
    private readonly meter: WorkMeter = { units: 0 },
  ) {
    this.tree = new BTree<SortKey, T>(undefined, (a, b) => this.compareKeys(a, b));
  }

  /** Inserting an existing key replaces its value. */
  insert(entry: T): void {
    this.tree.set(this.keyOf(entry), entry);
  }

  remove(key: SortKey): void {
    this.tree.delete(key);
  }

  /** Every entry, in order. */
  *values(): Generator<T> {
    for (const entry of this.tree.values()) {
      this.meter.units += 1;
      yield entry;
    }
  }

  /** Up to `count` entries strictly after `after`; from the first entry when it is null. */
  entriesAfter(after: SortKey | null, count: number): T[] {
    const entries: T[] = [];
    if (count <= 0) {
      return entries;
    }

    // The library seeks to the cursor but includes it when present. Our pages exclude it.
    for (const [key, entry] of this.tree.entries(after ?? undefined)) {
      this.meter.units += 1;
      if (after !== null && this.compareKeys(key, after) === 0) {
        continue;
      }
      entries.push(entry);
      if (entries.length === count) {
        break;
      }
    }

    return entries;
  }

  page(kind: string, request: PageRequest): Page<T> {
    return paginate({
      kind,
      request,
      keyOf: this.keyOf,
      itemsAfter: (after, count) => this.entriesAfter(after, count),
    });
  }

  private compareKeys(a: SortKey, b: SortKey): number {
    this.meter.units += 1;
    return compareSortKeys(a, b);
  }
}
