import { SetMetadata } from '@nestjs/common';
import { Scope } from '../scope';

export const REQUIRED_SCOPES_KEY = 'auth:requiredScopes';

/** Declares the scopes an API key must hold to call the handler. All listed scopes are required. */
export const RequireScopes = (...scopes: Scope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
