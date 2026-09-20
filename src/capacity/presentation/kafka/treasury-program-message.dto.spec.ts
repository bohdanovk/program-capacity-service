import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TreasuryProgramMessageDto } from './treasury-program-message.dto';

const limitChanged = {
  type: 'ProgramLimitChanged',
  programId: 'PRG-001',
  sequence: 12,
  occurredAt: '2026-09-19T10:15:00.000Z',
  currency: 'USD',
  creditLimit: '10000000.00',
};

const reconciled = {
  ...limitChanged,
  type: 'ProgramReconciled',
  activeReservations: [
    {
      invoiceId: 'INV-1',
      invoiceAmount: '250000.00',
      invoiceCurrency: 'EUR',
      reservedAmount: '271250.00',
    },
  ],
};

function violations(raw: unknown): string[] {
  const dto = plainToInstance(TreasuryProgramMessageDto, raw);
  return validateSync(dto, { whitelist: true, forbidUnknownValues: true }).flatMap((error) =>
    error.children?.length
      ? error.children.map((child) => `${error.property}.${child.property}`)
      : [error.property],
  );
}

describe('TreasuryProgramMessageDto (wire contract)', () => {
  it('accepts well-formed limit changes and snapshots', () => {
    expect(violations(limitChanged)).toEqual([]);
    expect(violations(reconciled)).toEqual([]);
  });

  it('requires the reservation list only for snapshots', () => {
    expect(violations({ ...reconciled, activeReservations: undefined })).toEqual([
      'activeReservations',
    ]);
    expect(violations({ ...limitChanged, activeReservations: undefined })).toEqual([]);
  });

  it.each([
    ['unknown type', { ...limitChanged, type: 'ProgramDeleted' }, 'type'],
    ['float amount', { ...limitChanged, creditLimit: 1.5 }, 'creditLimit'],
    ['negative amount', { ...limitChanged, creditLimit: '-5.00' }, 'creditLimit'],
    ['non-integer sequence', { ...limitChanged, sequence: 1.5 }, 'sequence'],
    ['non-ISO timestamp', { ...limitChanged, occurredAt: 'yesterday' }, 'occurredAt'],
    ['bad currency', { ...limitChanged, currency: 'US' }, 'currency'],
  ])('rejects %s', (_name, raw, property) => {
    expect(violations(raw)).toContain(property);
  });

  it('validates each snapshot entry', () => {
    const raw = {
      ...reconciled,
      activeReservations: [{ ...reconciled.activeReservations[0], reservedAmount: 'lots' }],
    };
    expect(violations(raw)).toEqual(['activeReservations.0']);
  });
});
