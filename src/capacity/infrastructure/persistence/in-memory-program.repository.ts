import { Injectable } from '@nestjs/common';
import { compareSortKeys, Page, PageRequest } from '../../../shared/pagination/pagination';
import { Currency } from '../../domain/currency';
import { ConcurrencyConflictError } from '../../domain/errors';
import { ProgramRepository } from '../../domain/ports/program.repository';
import { NO_RESERVATIONS, Program, ProgramMemento, ReservationScope } from '../../domain/program';
import { Reservation, ReservationMemento, ReservationStatus } from '../../domain/reservation';
import { OrderedIndex, WorkMeter } from './ordered-index';

const PROGRAM_CURSOR = 'programs';
const RESERVATION_CURSOR = 'reservations';

/** A reservation's place in a list: oldest first, the invoice id breaking ties. */
type ListPosition = readonly [reservedAt: string, invoiceId: string];

/** The reservation lists clients can page through: all of them, or one status. */
type ReservationList = 'ALL' | ReservationStatus;

interface StoredProgram {
  record: ProgramMemento;
  readonly reservations: Map<string, ReservationMemento>;
  readonly lists: Readonly<Record<ReservationList, OrderedIndex<ListPosition>>>;
}

/**
 * Process-local store laid out like the tables a database adapter would use: one record per
 * program, one per reservation, and an ordered index per reservation list. Records are plain
 * mementos, so every read builds its own objects and the version check behaves exactly like
 * `UPDATE ... WHERE version = ?`. Each call touches only the records it needs, and the
 * indexes are B+ trees, so no call slows down as programs accumulate reservations. Not
 * durable and not shared between instances: see README for the persistence story.
 */
@Injectable()
export class InMemoryProgramRepository implements ProgramRepository {
  private readonly store = new Map<string, StoredProgram>();
  private readonly meter: WorkMeter = { units: 0 };
  private readonly programOrder = new OrderedIndex<string>((id) => [id], this.meter);

  /**
   * Key comparisons and entries visited by this store's indexes so far. Lets tests detect
   * full scans without timing calls. Does not count moves inside sorted-btree.
   */
  get indexWork(): number {
    return this.meter.units;
  }

  findById(programId: string, scope: ReservationScope = NO_RESERVATIONS): Promise<Program | null> {
    const stored = this.store.get(programId);
    if (stored === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve(
      Program.rehydrate(stored.record, { scope, reservations: selectReservations(stored, scope) }),
    );
  }

  findPage(request: PageRequest): Promise<Page<Program>> {
    const page = this.programOrder.page(PROGRAM_CURSOR, request);

    return Promise.resolve({
      ...page,
      items: page.items.flatMap((programId) => {
        const stored = this.store.get(programId);
        return stored === undefined
          ? []
          : [Program.rehydrate(stored.record, { scope: NO_RESERVATIONS, reservations: [] })];
      }),
    });
  }

  findReservationPage(
    programId: string,
    request: PageRequest,
    status?: ReservationStatus,
  ): Promise<Page<Reservation>> {
    const stored = this.store.get(programId);
    if (stored === undefined) {
      return Promise.resolve({ items: [], nextCursor: null, limit: request.limit });
    }

    const currency = Currency.parse(stored.record.currency);
    const page = stored.lists[status ?? 'ALL'].page(RESERVATION_CURSOR, request);

    return Promise.resolve({
      ...page,
      items: page.items.flatMap(([, invoiceId]) => {
        const memento = stored.reservations.get(invoiceId);
        return memento === undefined ? [] : [Reservation.fromMemento(memento, currency)];
      }),
    });
  }

  save(program: Program): Promise<void> {
    const stored = this.store.get(program.id);
    const storedVersion = stored?.record.version ?? null;
    const expectedVersion = program.version === 0 ? null : program.version;

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new ConcurrencyConflictError(program.id));
    }

    const memento = program.toMemento();
    const record = { ...memento, version: memento.version + 1 };
    const changedReservations = program.changedReservations();
    const target = stored ?? this.insertProgram(record);

    target.record = record;
    for (const reservation of changedReservations) {
      writeReservation(target, reservation);
    }

    return Promise.resolve();
  }

  private insertProgram(record: ProgramMemento): StoredProgram {
    const stored: StoredProgram = {
      record,
      reservations: new Map(),
      lists: {
        ALL: this.newReservationList(),
        [ReservationStatus.Active]: this.newReservationList(),
        [ReservationStatus.Released]: this.newReservationList(),
      },
    };
    this.store.set(record.id, stored);
    this.programOrder.insert(record.id);

    return stored;
  }

  private newReservationList(): OrderedIndex<ListPosition> {
    return new OrderedIndex<ListPosition>((position) => position, this.meter);
  }
}

function listPosition(reservation: ReservationMemento): ListPosition {
  return [reservation.reservedAt.toISOString(), reservation.invoiceId];
}

function selectReservations(stored: StoredProgram, scope: ReservationScope): ReservationMemento[] {
  const selected = new Map<string, ReservationMemento>();
  const select = (invoiceId: string): void => {
    const reservation = stored.reservations.get(invoiceId);
    if (reservation !== undefined) {
      selected.set(invoiceId, reservation);
    }
  };

  scope.invoiceIds.forEach(select);
  if (scope.allActive) {
    for (const [, invoiceId] of stored.lists[ReservationStatus.Active].values()) {
      select(invoiceId);
    }
  }

  return [...selected.values()];
}

/** Stores one reservation record and keeps the list indexes in step with it. */
function writeReservation(stored: StoredProgram, next: ReservationMemento): void {
  const previous = stored.reservations.get(next.invoiceId);
  const to = listPosition(next);
  stored.reservations.set(next.invoiceId, next);

  if (previous === undefined) {
    stored.lists.ALL.insert(to);
    stored.lists[next.status].insert(to);
    return;
  }

  const from = listPosition(previous);
  const moved = compareSortKeys(from, to) !== 0;
  if (moved) {
    stored.lists.ALL.remove(from);
    stored.lists.ALL.insert(to);
  }
  if (moved || previous.status !== next.status) {
    stored.lists[previous.status].remove(from);
    stored.lists[next.status].insert(to);
  }
}
