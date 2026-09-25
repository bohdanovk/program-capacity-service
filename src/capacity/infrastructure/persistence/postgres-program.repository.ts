import { Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  Page,
  PageRequest,
} from '../../../shared/pagination/pagination';
import { ConcurrencyConflictError } from '../../domain/errors';
import { Currency } from '../../domain/currency';
import { ProgramRepository } from '../../domain/ports/program.repository';
import { NO_RESERVATIONS, Program, ProgramMemento, ReservationScope } from '../../domain/program';
import { Reservation, ReservationMemento, ReservationStatus } from '../../domain/reservation';

const PROGRAM_CURSOR = 'programs';
const RESERVATION_CURSOR = 'reservations';

interface StoredReservation extends Omit<
  ReservationMemento,
  'reservedAt' | 'releasedAt' | 'updatedAt'
> {
  readonly reservedAt: string;
  readonly releasedAt: string | null;
  readonly updatedAt: string;
}

interface StoredState extends Omit<
  ProgramMemento,
  'id' | 'version' | 'lastReconciledAt' | 'createdAt' | 'updatedAt'
> {
  readonly lastReconciledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProgramRow {
  readonly id: string;
  readonly version: number;
  readonly state: StoredState;
}

interface ScopedProgramRow extends ProgramRow {
  readonly reservations: readonly StoredReservation[];
}

interface ReservationRow {
  readonly currency: string;
  readonly state: StoredReservation;
}

/** Scoped reads share one snapshot; program versions and changed reservations commit together. */
export class PostgresProgramRepository
  implements ProgramRepository, OnModuleInit, OnApplicationShutdown
{
  private readonly pool: Pool;
  private readonly logger = new Logger(PostgresProgramRepository.name);

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    this.pool.on('error', (error) => {
      this.logger.error('Idle PostgreSQL connection failed', error);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      // Check both connectivity and schema before accepting traffic. Provisioning is explicit.
      await this.pool.query(`
        SELECT p.id, p.version, p.state, r.invoice_id, r.status, r.reserved_at, r.state
        FROM programs p LEFT JOIN reservations r ON r.program_id = p.id LIMIT 0
      `);
    } catch (error) {
      await this.pool.end();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // HTTP and Kafka finish active requests before this hook closes their database connections.
    if (!this.pool.ended) {
      await this.pool.end();
    }
  }

  async findById(
    programId: string,
    scope: ReservationScope = NO_RESERVATIONS,
  ): Promise<Program | null> {
    // One statement keeps totals and reservations consistent even if another save commits.
    const result = await this.pool.query<ScopedProgramRow>(
      `SELECT p.id, p.version, p.state,
        COALESCE((SELECT jsonb_agg(r.state) FROM reservations r
          WHERE r.program_id = p.id
            AND (r.invoice_id = ANY($2::text[]) OR ($3::boolean AND r.status = 'ACTIVE'))
        ), '[]'::jsonb) AS reservations
       FROM programs p WHERE p.id = $1`,
      [programId, scope.invoiceIds, scope.allActive],
    );
    const row = result.rows[0];
    return row === undefined ? null : rehydrate(row, scope, row.reservations);
  }

  async findPage(request: PageRequest): Promise<Page<Program>> {
    const key = request.cursor === null ? null : decodeCursor(PROGRAM_CURSOR, request.cursor);
    if (key !== null && key.length !== 1) {
      throw new InvalidCursorError();
    }
    const result = await this.pool.query<ProgramRow>(
      key === null
        ? 'SELECT id, version, state FROM programs ORDER BY id LIMIT $1'
        : 'SELECT id, version, state FROM programs WHERE id > $2 ORDER BY id LIMIT $1',
      key === null ? [request.limit + 1] : [request.limit + 1, key[0]],
    );
    const rows = result.rows.slice(0, request.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => rehydrate(row)),
      nextCursor:
        result.rows.length > request.limit && last !== undefined
          ? encodeCursor(PROGRAM_CURSOR, [last.id])
          : null,
      limit: request.limit,
    };
  }

  async findReservationPage(
    programId: string,
    request: PageRequest,
    status?: ReservationStatus,
  ): Promise<Page<Reservation>> {
    const key = request.cursor === null ? null : decodeCursor(RESERVATION_CURSOR, request.cursor);
    if (key !== null && key.length !== 2) {
      throw new InvalidCursorError();
    }
    const result = await this.pool.query<ReservationRow>(
      `SELECT r.state, p.state->>'currency' AS currency
       FROM reservations r JOIN programs p ON p.id = r.program_id
       WHERE r.program_id = $1 AND ($2::text IS NULL OR r.status = $2)
         ${key === null ? '' : 'AND (r.reserved_at, r.invoice_id) > ($4, $5)'}
       ORDER BY r.reserved_at, r.invoice_id LIMIT $3`,
      key === null
        ? [programId, status ?? null, request.limit + 1]
        : [programId, status ?? null, request.limit + 1, key[0], key[1]],
    );
    const rows = result.rows.slice(0, request.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) =>
        Reservation.fromMemento(reservationMemento(row.state), Currency.parse(row.currency)),
      ),
      nextCursor:
        result.rows.length > request.limit && last !== undefined
          ? encodeCursor(RESERVATION_CURSOR, [last.state.reservedAt, last.state.invoiceId])
          : null,
      limit: request.limit,
    };
  }

  async save(program: Program): Promise<void> {
    const { id, version, ...state } = program.toMemento();
    const changed = program.changedReservations();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result =
        version === 0
          ? await client.query(
              'INSERT INTO programs (id, version, state) VALUES ($1, 1, $2) ON CONFLICT (id) DO NOTHING',
              [id, state],
            )
          : await client.query(
              'UPDATE programs SET state = $2, version = version + 1 WHERE id = $1 AND version = $3',
              [id, state, version],
            );
      if (result.rowCount !== 1) {
        throw new ConcurrencyConflictError(id);
      }
      if (changed.length > 0) {
        await client.query(
          `INSERT INTO reservations (program_id, state)
           SELECT $1, value FROM jsonb_array_elements($2::jsonb)
           ON CONFLICT (program_id, invoice_id) DO UPDATE SET state = EXCLUDED.state`,
          [id, JSON.stringify(changed)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function rehydrate(
  { id, version, state }: ProgramRow,
  scope: ReservationScope = NO_RESERVATIONS,
  reservations: readonly StoredReservation[] = [],
): Program {
  return Program.rehydrate(
    {
      ...state,
      id,
      version,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
      lastReconciledAt: state.lastReconciledAt === null ? null : new Date(state.lastReconciledAt),
    },
    { scope, reservations: reservations.map(reservationMemento) },
  );
}

function reservationMemento(reservation: StoredReservation): ReservationMemento {
  return {
    ...reservation,
    reservedAt: new Date(reservation.reservedAt),
    releasedAt: reservation.releasedAt === null ? null : new Date(reservation.releasedAt),
    updatedAt: new Date(reservation.updatedAt),
  };
}
