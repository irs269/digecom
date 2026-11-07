import { HttpStatus, Injectable } from '@nestjs/common';
import {
  GLOBAL_ROLES,
  LEADER_ROLES,
  REQUIRED_LEADER_ROLE,
  ROLE_LABELS,
  ROLES_REQUIRING_ISLAND,
  ROLES_WITH_SITE,
  type CreateUserInput,
  type CreatedUserResponse,
  type LeaderTeamView,
  type Paginated,
  type ReassignInput,
  type Role,
  type TeamAssignmentView,
  type UpdateUserInput,
  type UserListQuery,
  type UserView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import { generateTemporaryPassword, hashPassword } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound, ScopeService } from '../scope/scope.service';

const USER_INCLUDE = {
  island: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
  leader: { select: { id: true, fullName: true, role: true } },
  _count: { select: { team: { where: { isActive: true } } } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

export function toUserView(u: UserRow): UserView {
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    isAvailable: u.isAvailable,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    island: u.island,
    site: u.site,
    leader: u.leader,
    teamSize: u._count.team,
  };
}

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);

const conflict = (code: string, message: string) =>
  new AppException(code, message, HttpStatus.CONFLICT);

interface Assignment {
  role: Role;
  islandId: string | null;
  siteId: string | null;
  leaderId: string | null;
}

const SORTS: Record<string, Prisma.UserOrderByWithRelationInput> = {
  fullName: { fullName: 'asc' },
  '-fullName': { fullName: 'desc' },
  lastLoginAt: { lastLoginAt: { sort: 'asc', nulls: 'first' } },
  '-lastLoginAt': { lastLoginAt: { sort: 'desc', nulls: 'last' } },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
};

export interface Change<T> {
  before: T | null;
  after: T;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async list(q: UserListQuery, actor: AuthUser): Promise<Paginated<UserView>> {
    const where: Prisma.UserWhereInput = {
      AND: [
        this.scope.users(actor),
        {
          role: q.role,
          islandId: q.islandId,
          siteId: q.siteId,
          leaderId: q.leaderId,
          isActive: q.status ? q.status === 'active' : undefined,
        },
        q.q
          ? {
              OR: [
                { fullName: { contains: q.q, mode: 'insensitive' } },
                { phone: { contains: q.q.replace(/[\s.-]/g, '') } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: [SORTS[q.sort ?? 'fullName'] ?? { fullName: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toUserView), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, actor: AuthUser): Promise<UserView> {
    const row = await this.prisma.user.findFirst({
      where: { AND: [{ id }, this.scope.users(actor)] },
      include: USER_INCLUDE,
    });
    if (!row) throw notFound('Compte');
    return toUserView(row);
  }

  async create(input: CreateUserInput, actor: AuthUser): Promise<CreatedUserResponse> {
    const assignment = await this.validateAssignment({
      role: input.role,
      islandId: input.islandId,
      siteId: input.siteId,
      leaderId: input.leaderId,
    });
    await this.ensureUnique(input.phone, input.email);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          passwordHash,
          mustChangePassword: true,
          ...assignment,
        },
      });
      if (assignment.leaderId) {
        await tx.teamAssignmentHistory.create({
          data: {
            userId: user.id,
            fromLeaderId: null,
            toLeaderId: assignment.leaderId,
            reason: 'Création du compte',
            byId: actor.id,
          },
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: USER_INCLUDE });
    });
    return { user: toUserView(created), temporaryPassword };
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser): Promise<Change<UserView>> {
    const existing = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!existing) throw notFound('Compte');
    if (id === actor.id && input.role && input.role !== existing.role) {
      throw conflict('SELF_ROLE_CHANGE', 'Tu ne peux pas changer ton propre rôle');
    }

    const role = input.role ?? existing.role;
    const islandId = input.islandId !== undefined ? input.islandId : existing.islandId;
    // Le site est réinitialisé si l'île change sans nouveau site.
    const siteId =
      input.siteId !== undefined
        ? input.siteId
        : islandId !== existing.islandId
          ? null
          : existing.siteId;
    // Le rattachement à un leader ne change que par réaffectation.
    const leaderId = REQUIRED_LEADER_ROLE[role] ? existing.leaderId : null;

    if (LEADER_ROLES.includes(existing.role) && existing._count.team > 0) {
      if (role !== existing.role) {
        throw conflict(
          'TEAM_NOT_EMPTY',
          'Ce leader a encore une équipe : réaffecte ses membres avant de changer son rôle',
        );
      }
      if (islandId !== existing.islandId) {
        throw conflict(
          'TEAM_NOT_EMPTY',
          'Ce leader a encore une équipe : réaffecte ses membres avant de changer son île',
        );
      }
    }

    const assignment = await this.validateAssignment(
      { role, islandId, siteId, leaderId },
      { reassignHint: true },
    );
    if (input.phone || input.email) await this.ensureUnique(input.phone, input.email, id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        ...assignment,
      },
      include: USER_INCLUDE,
    });
    return { before: toUserView(existing), after: toUserView(updated) };
  }

  async setActive(id: string, active: boolean, actor: AuthUser): Promise<Change<UserView>> {
    if (id === actor.id && !active) {
      throw conflict('SELF_DEACTIVATION', 'Tu ne peux pas désactiver ton propre compte');
    }
    const existing = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!existing) throw notFound('Compte');
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: active, ...(active ? {} : { isAvailable: false }) },
        include: USER_INCLUDE,
      }),
      // Désactivation : toutes les sessions sont révoquées immédiatement.
      ...(active
        ? []
        : [
            this.prisma.refreshToken.updateMany({
              where: { userId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]),
    ]);
    return { before: toUserView(existing), after: toUserView(updated) };
  }

  async resetPassword(id: string): Promise<{ user: UserView; temporaryPassword: string }> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('Compte');
    const temporaryPassword = generateTemporaryPassword();
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          failedLogins: 0,
          lockedUntil: null,
        },
        include: USER_INCLUDE,
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { user: toUserView(updated), temporaryPassword };
  }

  /**
   * Réaffecte un vendeur à un autre leader du bon type. Le vendeur suit l'île du nouveau leader
   * (règle « même île ») ; son site éventuel est retiré. Historisé dans TeamAssignmentHistory.
   */
  async reassign(id: string, input: ReassignInput, actor: AuthUser): Promise<Change<UserView>> {
    const existing = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!existing) throw notFound('Compte');
    const requiredRole = REQUIRED_LEADER_ROLE[existing.role];
    if (!requiredRole) {
      throw invalid('userId', 'Seuls les e-commerçants et les téléconseillers ont un leader');
    }
    if (!existing.isActive) throw invalid('userId', 'Ce compte est désactivé');
    if (existing.leaderId === input.leaderId) {
      throw invalid('leaderId', 'Ce vendeur est déjà dans cette équipe');
    }
    const leader = await this.prisma.user.findUnique({ where: { id: input.leaderId } });
    if (!leader || !leader.isActive || leader.role !== requiredRole) {
      throw invalid(
        'leaderId',
        `Le nouveau leader doit être un ${ROLE_LABELS[requiredRole]} actif`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.teamAssignmentHistory.create({
        data: {
          userId: id,
          fromLeaderId: existing.leaderId,
          toLeaderId: leader.id,
          reason: input.reason,
          byId: actor.id,
        },
      });
      return tx.user.update({
        where: { id },
        data: { leaderId: leader.id, islandId: leader.islandId, siteId: null },
        include: USER_INCLUDE,
      });
    });
    return { before: toUserView(existing), after: toUserView(updated) };
  }

  async teamHistory(userId: string, actor: AuthUser): Promise<TeamAssignmentView[]> {
    await this.get(userId, actor);
    return this.history({ userId });
  }

  async history(where: Prisma.TeamAssignmentHistoryWhereInput): Promise<TeamAssignmentView[]> {
    const person = { select: { id: true, fullName: true } };
    const rows = await this.prisma.teamAssignmentHistory.findMany({
      where,
      orderBy: { at: 'desc' },
      take: 200,
      include: { user: person, fromLeader: person, toLeader: person, by: person },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      reason: r.reason,
      user: r.user,
      fromLeader: r.fromLeader,
      toLeader: r.toLeader,
      by: r.by,
    }));
  }

  /** Leaders (Senior et Junior) avec leurs membres actifs. */
  async leaders(
    filter: { role?: Role; islandId?: string },
    actor: AuthUser,
  ): Promise<LeaderTeamView[]> {
    const leaders = await this.prisma.user.findMany({
      where: {
        AND: [
          this.scope.users(actor),
          { role: filter.role ?? { in: [...LEADER_ROLES] }, islandId: filter.islandId },
        ],
      },
      include: {
        ...USER_INCLUDE,
        team: { include: USER_INCLUDE, orderBy: { fullName: 'asc' } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    return leaders
      .filter((l) => LEADER_ROLES.includes(l.role))
      .map((l) => ({ leader: toUserView(l), members: l.team.map(toUserView) }));
  }

  async team(leaderId: string, actor: AuthUser): Promise<LeaderTeamView> {
    const [view] = await this.leaders({}, actor).then((all) =>
      all.filter((t) => t.leader.id === leaderId),
    );
    if (!view) throw notFound('Leader');
    return view;
  }

  // --- validations -------------------------------------------------------------

  private async ensureUnique(phone?: string, email?: string | null, exceptId?: string) {
    if (phone) {
      const other = await this.prisma.user.findUnique({ where: { phone } });
      if (other && other.id !== exceptId) {
        throw conflict('PHONE_TAKEN', 'Ce numéro de téléphone est déjà utilisé');
      }
    }
    if (email) {
      const other = await this.prisma.user.findUnique({ where: { email } });
      if (other && other.id !== exceptId) {
        throw conflict('EMAIL_TAKEN', 'Cette adresse e-mail est déjà utilisée');
      }
    }
  }

  /** Règles de rattachement île / site / leader selon le rôle (SPEC §3, PERMISSIONS.md). */
  async validateAssignment(
    a: Assignment,
    opts: { reassignHint?: boolean } = {},
  ): Promise<Assignment> {
    const { role } = a;

    if (GLOBAL_ROLES.includes(role)) {
      if (a.islandId || a.siteId || a.leaderId) {
        throw invalid('islandId', `Un ${ROLE_LABELS[role]} n'est rattaché à aucune île`);
      }
      return { role, islandId: null, siteId: null, leaderId: null };
    }

    if (ROLES_REQUIRING_ISLAND.includes(role) && !a.islandId) {
      throw invalid('islandId', `Un ${ROLE_LABELS[role]} doit avoir une île`);
    }
    const island = a.islandId
      ? await this.prisma.island.findUnique({ where: { id: a.islandId } })
      : null;
    if (a.islandId && !island) throw invalid('islandId', 'Île inconnue');

    if (a.siteId) {
      if (!ROLES_WITH_SITE.includes(role)) {
        throw invalid('siteId', `Un ${ROLE_LABELS[role]} n'est pas rattaché à un site`);
      }
      const site = await this.prisma.site.findUnique({ where: { id: a.siteId } });
      if (!site || !site.isActive) throw invalid('siteId', 'Site inconnu ou désactivé');
      if (site.islandId !== a.islandId) {
        throw invalid('siteId', "Le site doit être sur l'île de l'utilisateur");
      }
    }

    const requiredLeaderRole = REQUIRED_LEADER_ROLE[role];
    if (!requiredLeaderRole) {
      if (a.leaderId) throw invalid('leaderId', `Un ${ROLE_LABELS[role]} n'a pas de leader`);
      return { role, islandId: a.islandId, siteId: a.siteId, leaderId: null };
    }

    const hint = opts.reassignHint ? ' (utilise la réaffectation)' : '';
    if (!a.leaderId) {
      throw invalid(
        'leaderId',
        `Un ${ROLE_LABELS[role]} doit être rattaché à un ${ROLE_LABELS[requiredLeaderRole]}${hint}`,
      );
    }
    const leader = await this.prisma.user.findUnique({ where: { id: a.leaderId } });
    if (!leader || leader.role !== requiredLeaderRole) {
      throw invalid(
        'leaderId',
        `Un ${ROLE_LABELS[role]} doit être rattaché à un ${ROLE_LABELS[requiredLeaderRole]}${hint}`,
      );
    }
    if (!leader.isActive) throw invalid('leaderId', 'Ce leader est désactivé');
    if (leader.islandId !== a.islandId) {
      throw invalid('leaderId', `Le leader doit être sur la même île que le vendeur${hint}`);
    }
    return { role, islandId: a.islandId, siteId: null, leaderId: leader.id };
  }
}
