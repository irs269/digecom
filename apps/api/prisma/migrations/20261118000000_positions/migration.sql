-- Positions GPS : sites (point de retrait) et dernière position des utilisateurs mobiles.
ALTER TABLE "Site" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "lastLatitude" DOUBLE PRECISION, ADD COLUMN "lastLongitude" DOUBLE PRECISION, ADD COLUMN "lastLocationAt" TIMESTAMP(3);
