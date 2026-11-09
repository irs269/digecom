import { createAdmin } from './create-admin';

/** Prisma factice : seules les méthodes utilisées par createAdmin. */
function fakePrisma(existingPhone?: string) {
  const created: unknown[] = [];
  const upsert = jest.fn(async () => ({ id: 'x' }));
  return {
    created,
    prisma: {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { phone: string } }) =>
          where.phone === existingPhone ? { id: 'u' } : null,
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { ...data, id: 'admin' };
        }),
      },
      island: { upsert },
      site: { upsert },
      setting: { upsert },
    },
  };
}

describe('create-admin', () => {
  it('crée un Administrateur général (téléphone normalisé, mot de passe haché)', async () => {
    const f = fakePrisma();
    const { user, reference } = await createAdmin(f.prisma as never, {
      fullName: " Direction Dig'eCom ",
      phone: '333 00 01',
      password: 'Moroni2026x',
    });
    expect(user).toMatchObject({
      fullName: "Direction Dig'eCom",
      phone: '+2693330001',
      role: 'ADMIN',
    });
    expect((f.created[0] as { passwordHash: string }).passwordHash).toMatch(/^\$argon2id\$/);
    expect(reference).toEqual({ islands: 3, sites: 3, settings: expect.any(Number) });
  });

  it('applique la politique de mot de passe et refuse un téléphone déjà pris', async () => {
    const f = fakePrisma('+2693330001');
    await expect(
      createAdmin(f.prisma as never, { fullName: 'Admin', phone: '3330002', password: 'court1' }),
    ).rejects.toThrow(/10 caractères/);
    await expect(
      createAdmin(f.prisma as never, {
        fullName: 'Admin',
        phone: '3330001',
        password: 'Moroni2026x',
      }),
    ).rejects.toThrow(/déjà utilisé/);
    expect(f.created).toHaveLength(0);
  });
});
