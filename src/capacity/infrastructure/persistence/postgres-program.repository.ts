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
import { ProgramRepository } from '../../domain/ports/program.repository';
import { Program, ProgramMemento, ReservationMemento } from '../../domain/program';

const PROGRAM_CURSOR = 'programs';

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
  'id' | 'version' | 'reservations' | 'lastReconciledAt' | 'createdAt' | 'updatedAt'
> {
  readonly reservations: readonly StoredReservation[];
  readonly lastReconciledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProgramRow {
  readonly id: string;
  readonly version: number;
  readonly state: StoredState;
}

/** Each aggregate is one row, so state and its version change in a single atomic statement. */
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
      await this.pool.query('SELECT id, version, state FROM programs LIMIT 0');
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

  async findById(programId: string): Promise<Program | null> {
    const result = await this.pool.query<ProgramRow>(
      'SELECT id, version, state FROM programs WHERE id = $1',
      [programId],
    );
    const row = result.rows[0];
    return row === undefined ? null : rehydrate(row);
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
      items: rows.map(rehydrate),
      nextCursor:
        result.rows.length > request.limit && last !== undefined
          ? encodeCursor(PROGRAM_CURSOR, [last.id])
          : null,
      limit: request.limit,
    };
  }

  async save(program: Program): Promise<void> {
    const { id, version, ...state } = program.toMemento();
    const result =
      version === 0
        ? await this.pool.query(
            'INSERT INTO programs (id, version, state) VALUES ($1, 1, $2) ON CONFLICT (id) DO NOTHING',
            [id, state],
          )
        : await this.pool.query(
            'UPDATE programs SET state = $2, version = version + 1 WHERE id = $1 AND version = $3',
            [id, state, version],
          );
    if (result.rowCount !== 1) {
      throw new ConcurrencyConflictError(id);
    }
  }
}

function rehydrate({ id, version, state }: ProgramRow): Program {
  return Program.rehydrate({
    ...state,
    id,
    version,
    createdAt: new Date(state.createdAt),
    updatedAt: new Date(state.updatedAt),
    lastReconciledAt: state.lastReconciledAt === null ? null : new Date(state.lastReconciledAt),
    reservations: state.reservations.map((reservation) => ({
      ...reservation,
      reservedAt: new Date(reservation.reservedAt),
      releasedAt: reservation.releasedAt === null ? null : new Date(reservation.releasedAt),
      updatedAt: new Date(reservation.updatedAt),
    })),
  });
}
