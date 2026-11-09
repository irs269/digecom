-- Phase 7 : clé étrangère StockMovement.orderId → Order (dette notée en phase 2).
-- NOT VALID puis validation : StockMovement est append-only (trigger), on ne peut pas corriger
-- d'éventuelles lignes orphelines par UPDATE ; la contrainte s'applique alors aux nouvelles lignes
-- et la validation est tentée seulement si aucune ligne existante n'est orpheline.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "StockMovement" m
    WHERE m."orderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = m."orderId")
  ) THEN
    ALTER TABLE "StockMovement" VALIDATE CONSTRAINT "StockMovement_orderId_fkey";
  ELSE
    RAISE WARNING 'StockMovement : mouvements orphelins, contrainte non validée (lignes existantes)';
  END IF;
END $$;
