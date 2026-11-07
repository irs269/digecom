import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ROLE_SCOPE, type ScopeKind } from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';

/**
 * Noms des colonnes de périmètre d'une entité. Chaque service de lecture déclare les siennes,
 * ex. commandes : `{ island: 'islandId', leader: 'leaderId', owner: 'sellerId' }`.
 */
export interface ScopeFields {
  island?: string;
  leader?: string;
  owner?: string;
}

/** Filtre « rien » : aucune ligne ne correspond (id impossible). */
const NOTHING = { id: '__hors_perimetre__' } as const;

export const notFound = (what = 'Ressource') =>
  new AppException('NOT_FOUND', `${what} introuvable`, HttpStatus.NOT_FOUND);

/**
 * Règles de périmètre de docs/PERMISSIONS.md :
 * - GLOBAL (ADMIN, FINANCE, ACCOUNTANT, ACC_ASSIST) : tout, filtre île facultatif ;
 * - ISLAND (CASHIER, STOCK, LOGISTICS, COURIER) : `islandId` = leur île ;
 * - LEADER (LEADER_*) : `leaderId` = eux ;
 * - OWNER (SELLER, TELECONSULTANT) : leurs propres lignes.
 * Une donnée hors périmètre est traitée comme inexistante (404).
 */
@Injectable()
export class ScopeService {
  kind(user: AuthUser): ScopeKind {
    return ROLE_SCOPE[user.role];
  }

  /**
   * Filtre Prisma (objet `where`) d'une entité pour l'utilisateur courant.
   * Si l'entité n'a pas la colonne exigée par le rôle, rien n'est visible.
   */
  filter<W extends Record<string, unknown>>(
    user: AuthUser,
    fields: ScopeFields,
    islandFilter?: string | null,
  ): W {
    switch (this.kind(user)) {
      case 'GLOBAL':
        return (islandFilter && fields.island ? { [fields.island]: islandFilter } : {}) as W;
      case 'ISLAND':
        if (!fields.island || !user.islandId) return NOTHING as unknown as W;
        return { [fields.island]: user.islandId } as W;
      case 'LEADER':
        if (!fields.leader) return NOTHING as unknown as W;
        return { [fields.leader]: user.id } as W;
      case 'OWNER':
        if (!fields.owner) return NOTHING as unknown as W;
        return { [fields.owner]: user.id } as W;
    }
  }

  /** Comptes visibles : soi-même toujours, puis selon le périmètre. */
  users(user: AuthUser, islandFilter?: string | null): Prisma.UserWhereInput {
    switch (this.kind(user)) {
      case 'GLOBAL':
        return islandFilter ? { islandId: islandFilter } : {};
      case 'ISLAND':
        return { OR: [{ id: user.id }, { islandId: user.islandId ?? NOTHING.id }] };
      case 'LEADER':
        return { OR: [{ id: user.id }, { leaderId: user.id }] };
      case 'OWNER':
        return { id: user.id };
    }
  }

  /** Sites visibles : toutes les îles pour les rôles globaux, sinon l'île de l'utilisateur. */
  sites(user: AuthUser, islandFilter?: string | null): Prisma.SiteWhereInput {
    if (this.kind(user) === 'GLOBAL') return islandFilter ? { islandId: islandFilter } : {};
    return { islandId: user.islandId ?? NOTHING.id };
  }

  /**
   * Leader dont un vendeur voit le catalogue et le stock (SELLER, TELECONSULTANT),
   * ou le leader lui-même. `null` pour les autres rôles.
   */
  catalogLeaderId(user: AuthUser): string | null {
    if (user.role === 'SELLER' || user.role === 'TELECONSULTANT') return user.leaderId;
    if (user.role === 'LEADER_SENIOR' || user.role === 'LEADER_JUNIOR') return user.id;
    return null;
  }

  /** Lève 404 si l'enregistrement est absent (hors périmètre compris). */
  ensureFound<T>(record: T | null | undefined, what?: string): T {
    if (!record) throw notFound(what);
    return record;
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}
