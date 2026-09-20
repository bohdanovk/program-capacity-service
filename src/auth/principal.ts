import { Scope } from './scope';

/** The authenticated caller attached to a request. */
export interface Principal {
  readonly name: string;
  readonly scopes: ReadonlySet<Scope>;
}
