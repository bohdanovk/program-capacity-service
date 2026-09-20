import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { Principal } from './principal';
import { isScope, Scope } from './scope';

interface RegisteredKey {
  readonly digest: Buffer;
  readonly principal: Principal;
}

/**
 * Looks up API keys in constant time relative to the presented value: every registered key
 * is compared, via fixed-length SHA-256 digests, so response timing leaks nothing about
 * which key (if any) matched.
 */
@Injectable()
export class ApiKeyRegistry {
  private readonly keys: readonly RegisteredKey[];

  constructor(config: ConfigService<AppConfig, true>) {
    this.keys = config.get('auth.apiKeys', { infer: true }).map((entry) => ({
      digest: digest(entry.key),
      principal: { name: entry.name, scopes: new Set(entry.scopes.map(toScope(entry.name))) },
    }));
  }

  authenticate(presentedKey: string): Principal | null {
    const presented = digest(presentedKey);
    let match: Principal | null = null;
    for (const registered of this.keys) {
      if (timingSafeEqual(presented, registered.digest)) {
        match = registered.principal;
      }
    }
    return match;
  }
}

function toScope(keyName: string): (scope: string) => Scope {
  return (scope) => {
    if (!isScope(scope)) {
      throw new Error(
        `API key "${keyName}" has unknown scope "${scope}" (allowed: ${Object.values(Scope).join(', ')})`,
      );
    }
    return scope;
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
