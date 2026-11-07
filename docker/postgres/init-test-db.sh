#!/bin/sh
# Crée la base de test à la première initialisation du volume PostgreSQL.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE ${POSTGRES_DB}_test;
EOSQL
