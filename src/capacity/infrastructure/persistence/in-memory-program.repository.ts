import { Injectable } from '@nestjs/common';
import {
  compareSortKeys,
  Page,
  PageRequest,
  paginateSorted,
} from '../../../shared/pagination/pagination';
import { ConcurrencyConflictError } from '../../domain/errors';
import { ProgramRepository } from '../../domain/ports/program.repository';
import { Program, ProgramMemento } from '../../domain/program';

const PROGRAM_CURSOR = 'programs';

/**
 * Process-local store. It keeps mementos rather than live aggregates, so every read gets its
 * own copy and the version check behaves exactly like a `WHERE version = ?` update would in
 * SQL. Not durable and not shared between instances: see README for the persistence story.
 */
@Injectable()
export class InMemoryProgramRepository implements ProgramRepository {
  private readonly store = new Map<string, ProgramMemento>();

  findById(programId: string): Promise<Program | null> {
    const memento = this.store.get(programId);

    return Promise.resolve(memento === undefined ? null : Program.rehydrate(memento));
  }

  findPage(request: PageRequest): Promise<Page<Program>> {
    const sorted = [...this.store.values()].sort((a, b) => compareSortKeys([a.id], [b.id]));
    const page = paginateSorted({
      kind: PROGRAM_CURSOR,
      sorted,
      request,
      keyOf: (memento) => [memento.id],
    });

    return Promise.resolve({
      ...page,
      items: page.items.map((memento) => Program.rehydrate(memento)),
    });
  }

  save(program: Program): Promise<void> {
    const storedVersion = this.store.get(program.id)?.version ?? null;
    const expectedVersion = program.version === 0 ? null : program.version;

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new ConcurrencyConflictError(program.id));
    }

    const memento = program.toMemento();
    this.store.set(program.id, { ...memento, version: memento.version + 1 });

    return Promise.resolve();
  }
}
