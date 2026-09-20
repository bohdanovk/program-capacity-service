import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { API_KEY_HEADER } from './api-key.constants';
import { ApiKeyRegistry } from './api-key.registry';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { REQUIRED_SCOPES_KEY } from './decorators/require-scopes.decorator';
import { Principal } from './principal';
import { Scope } from './scope';

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

/**
 * Global guard: every HTTP route needs a valid API key unless marked @Public(), and a key
 * must carry every scope the handler declares with @RequireScopes().
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registry: ApiKeyRegistry,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const presentedKey = request.header(API_KEY_HEADER);
    const principal = presentedKey === undefined ? null : this.registry.authenticate(presentedKey);
    if (principal === null) {
      throw new UnauthorizedException(`Missing or invalid ${API_KEY_HEADER} header`);
    }

    const requiredScopes = this.reflector.getAllAndOverride<Scope[] | undefined>(
      REQUIRED_SCOPES_KEY,
      targets,
    );
    const missing = (requiredScopes ?? []).filter((scope) => !principal.scopes.has(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`API key lacks required scope(s): ${missing.join(', ')}`);
    }

    request.principal = principal;

    return true;
  }
}
