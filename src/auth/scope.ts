/** Permissions an API key can hold. Read-only keys are for reporting and monitoring clients. */
export enum Scope {
  Read = 'read',
  Write = 'write',
}

export function isScope(value: string): value is Scope {
  return (Object.values(Scope) as string[]).includes(value);
}
