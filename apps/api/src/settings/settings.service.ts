import { HttpStatus, Injectable } from '@nestjs/common';
import {
  businessToday,
  isSettingKey,
  SETTING_KEYS,
  SETTINGS,
  startOfBusinessDay,
  toBusinessDay,
  type SettingKey,
  type SettingValue,
  type SettingVersion,
  type SettingView,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);

type Row = Prisma.SettingGetPayload<{ include: { by: { select: { id: true; fullName: true } } } }>;

const toVersion = (r: Row): SettingVersion => ({
  id: r.id,
  value: r.value,
  effectiveFrom: r.effectiveFrom.toISOString(),
  createdAt: r.createdAt.toISOString(),
  by: r.by,
});

/**
 * Paramètres versionnés : chaque modification crée une nouvelle version avec une date d'effet,
 * aucune version n'est jamais modifiée ni supprimée. La valeur lue à une date est la version la
 * plus récente dont `effectiveFrom <= date` ; à défaut, la valeur par défaut du registre.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K, at: Date = new Date()): Promise<SettingValue<K>> {
    const row = await this.prisma.setting.findFirst({
      where: { key, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (!row) return SETTINGS[key].defaultValue as SettingValue<K>;
    // Valeurs déjà validées à l'écriture ; on revalide par sécurité.
    return SETTINGS[key].schema.parse(row.value) as SettingValue<K>;
  }

  async getAll(at: Date = new Date()): Promise<{ [K in SettingKey]: SettingValue<K> }> {
    const entries = await Promise.all(SETTING_KEYS.map(async (k) => [k, await this.get(k, at)]));
    return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
  }

  async views(now: Date = new Date()): Promise<SettingView[]> {
    const rows = await this.prisma.setting.findMany({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { by: { select: { id: true, fullName: true } } },
    });
    return SETTING_KEYS.map((key) => {
      const d = SETTINGS[key];
      const versions = rows.filter((r) => r.key === key);
      const current = versions.find((v) => v.effectiveFrom <= now);
      return {
        key,
        label: d.label,
        help: d.help,
        group: d.group,
        input: d.input,
        unit: 'unit' in d ? d.unit : undefined,
        current: current ? current.value : d.defaultValue,
        currentEffectiveFrom: current?.effectiveFrom.toISOString() ?? null,
        upcoming: versions.filter((v) => v.effectiveFrom > now).map(toVersion),
        history: versions.filter((v) => v.effectiveFrom <= now).map(toVersion),
      };
    });
  }

  /** Nouvelle version ; date d'effet aujourd'hui (immédiat) ou plus tard (00:00 heure des Comores). */
  async createVersion(
    key: string,
    rawValue: unknown,
    effectiveFromDay: string,
    byId: string,
    now: Date = new Date(),
  ): Promise<{ before: unknown; after: SettingVersion }> {
    if (!isSettingKey(key)) {
      throw new AppException('NOT_FOUND', 'Paramètre inconnu', HttpStatus.NOT_FOUND);
    }
    const today = businessToday(now);
    let effectiveFrom: Date;
    try {
      effectiveFrom = effectiveFromDay === today ? now : startOfBusinessDay(effectiveFromDay);
    } catch {
      throw invalid('effectiveFrom', 'Date invalide');
    }
    if (effectiveFromDay < today) {
      throw invalid('effectiveFrom', "La date d'effet ne peut pas être dans le passé");
    }

    const parsed = SETTINGS[key].schema.safeParse(rawValue);
    if (!parsed.success) {
      throw new AppException(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Valeur invalide',
        HttpStatus.UNPROCESSABLE_ENTITY,
        parsed.error.issues.map((i) => ({
          path: ['value', ...i.path].join('.'),
          message: i.message,
        })),
      );
    }
    await this.checkCrossRules(key, parsed.data, effectiveFrom);

    const before = await this.get(key, effectiveFrom);
    const existing = await this.prisma.setting.findUnique({
      where: { key_effectiveFrom: { key, effectiveFrom } },
    });
    if (existing) {
      // Jamais d'écrasement : une version par clé et par date d'effet.
      throw new AppException(
        'SETTING_VERSION_EXISTS',
        `Une version est déjà prévue le ${toBusinessDay(effectiveFrom)} pour ce paramètre`,
        HttpStatus.CONFLICT,
      );
    }
    const row = await this.prisma.setting.create({
      data: { key, value: parsed.data as Prisma.InputJsonValue, effectiveFrom, byId },
      include: { by: { select: { id: true, fullName: true } } },
    });
    return { before, after: toVersion(row) };
  }

  /** Règles entre clés, vérifiées à la date d'effet et pour les versions futures déjà prévues. */
  private async checkCrossRules(key: SettingKey, value: unknown, at: Date) {
    if (key !== 'tci.bonusMin' && key !== 'tci.bonusMax') return;
    const other = key === 'tci.bonusMin' ? 'tci.bonusMax' : 'tci.bonusMin';
    const dates = [
      at,
      ...(
        await this.prisma.setting.findMany({
          where: { key: other, effectiveFrom: { gt: at } },
          select: { effectiveFrom: true },
        })
      ).map((r) => r.effectiveFrom),
    ];
    for (const d of dates) {
      const otherValue = await this.get(other, d);
      const min = key === 'tci.bonusMin' ? (value as number) : otherValue;
      const max = key === 'tci.bonusMax' ? (value as number) : otherValue;
      if (min > max) {
        throw invalid(
          'value',
          `La prime TCI minimale (${min}) doit rester inférieure ou égale à la maximale (${max})`,
        );
      }
    }
  }
}
