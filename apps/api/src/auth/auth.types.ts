import type { Role } from '@digecom/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: Role;
  islandId: string | null;
  siteId: string | null;
  leaderId: string | null;
  mustChangePassword: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

/** Contexte rempli par un handler pour enrichir l'entrée d'audit (avant / après). */
export interface AuditContext {
  /** Nom métier de l'action (ex. USER_CREATE). Par défaut : `METHODE /route`. */
  action?: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  skip?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  id: string;
  audit?: AuditContext;
}

export type MaybeAuthenticatedRequest = Omit<AuthenticatedRequest, 'user'> & { user?: AuthUser };
