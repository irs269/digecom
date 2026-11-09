import { grantStatements } from './db-grants';

describe('rôle applicatif PostgreSQL', () => {
  it('aucune modification des tables append-only, mot de passe échappé', () => {
    const sql = grantStatements('digecom_app', "a'b-secret-tres-long").join(';\n');
    expect(sql).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog", "StockMovement", "OrderEvent", "LedgerEntry", "SellerAllocation"',
    );
    expect(sql).toContain("PASSWORD 'a''b-secret-tres-long'");
    expect(sql).not.toMatch(/GRANT (ALL|CREATE)/);
  });

  it('refuse un nom de rôle dangereux', () => {
    expect(() => grantStatements('x"; DROP TABLE "User', 'p'.repeat(20))).toThrow(/invalide/);
  });
});
