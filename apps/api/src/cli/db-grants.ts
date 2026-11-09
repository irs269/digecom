/**
 * Rôle PostgreSQL applicatif (production), exécuté par le service `migrate` après
 * `prisma migrate deploy`, avec l'utilisateur propriétaire du schéma :
 *   - connexion avec APP_DB_USER / APP_DB_PASSWORD (créé ou mot de passe mis à jour) ;
 *   - lecture / écriture des données, aucune DDL (le rôle ne possède rien) ;
 *   - tables append-only : ni UPDATE, ni DELETE, ni TRUNCATE ;
 *   - _prisma_migrations en lecture seule (contrôle /ready).
 *
 *   APP_DB_USER=digecom_app APP_DB_PASSWORD=… node dist/cli/db-grants.js
 */
import { PrismaClient } from '@prisma/client';

export const APPEND_ONLY = [
  'AuditLog',
  'StockMovement',
  'OrderEvent',
  'LedgerEntry',
  'SellerAllocation',
] as const;

const ident = (v: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v)) throw new Error(`Nom de rôle invalide : ${v}`);
  return `"${v}"`;
};
const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function grantStatements(user: string, password: string): string[] {
  const role = ident(user);
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(user)}) THEN
         CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
       END IF;
     END $$`,
    `ALTER ROLE ${role} WITH LOGIN PASSWORD ${literal(password)}`,
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    `REVOKE ALL ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `REVOKE UPDATE, DELETE, TRUNCATE ON ${APPEND_ONLY.map((t) => `"${t}"`).join(', ')} FROM ${role}`,
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM ${role}`,
  ];
}

if (require.main === module) {
  const user = process.env.APP_DB_USER ?? '';
  const password = process.env.APP_DB_PASSWORD ?? '';
  const prisma = new PrismaClient();
  (async () => {
    if (!user || password.length < 16)
      throw new Error('APP_DB_USER et APP_DB_PASSWORD (16 caractères minimum) sont requis');
    for (const sql of grantStatements(user, password)) await prisma.$executeRawUnsafe(sql);
    console.log(`Droits appliqués au rôle ${user} (append-only : ${APPEND_ONLY.join(', ')})`);
  })()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
