#!/bin/sh
# Restauration Dig'eCom – depuis /opt/digecom :
#   ./scripts/restore.sh BACKUP_DIR/AAAA-MM-JJ_HHMMSS            # TEST : base temporaire, vérifiée puis supprimée
#   ./scripts/restore.sh BACKUP_DIR/AAAA-MM-JJ_HHMMSS --production  # remplace la base ET les fichiers
#
# Contrôles : empreintes SHA256SUMS, puis nombres de lignes restaurés = manifest.txt.
set -eu

cd "$(dirname "$0")/.."
SRC=${1:?Usage : restore.sh <dossier de sauvegarde> [--production]}
MODE=${2:-test}
ENV_FILE=${ENV_FILE:-.env}
case "$ENV_FILE" in /* | [A-Za-z]:*) ;; *) ENV_FILE="./$ENV_FILE" ;; esac
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
COMPOSE="docker compose -f compose.prod.yml --env-file $ENV_FILE"
PROJECT=${COMPOSE_PROJECT_NAME:-digecom-prod}
MC_IMAGE=chainguard/minio-client@sha256:7e80e77f8c949810d0eaead1120e28c63f913ff96ae7f78a8e4cd3c1e2f0623f
PSQL="$COMPOSE exec -T postgres psql -X -v ON_ERROR_STOP=1 -U $POSTGRES_USER"

log() { echo "$(date '+%F %T') [restore] $*"; }

[ -f "$SRC/db.dump" ] && [ -f "$SRC/manifest.txt" ] || { echo "Sauvegarde incomplète : $SRC"; exit 2; }
(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || { echo "Empreintes invalides : fichiers altérés"; exit 3; }
log "empreintes vérifiées"

if [ "$MODE" = "--production" ]; then
  TARGET=${POSTGRES_DB:-digecom}
  printf "Cette restauration REMPLACE la base « %s » et les fichiers. Taper RESTAURER pour confirmer : " "$TARGET"
  read -r answer; [ "$answer" = "RESTAURER" ] || { echo "Annulé."; exit 1; }
  log "arrêt du web et de l'api"
  $COMPOSE stop web api
  WORK=${TARGET}_restore_tmp
else
  TARGET=${POSTGRES_DB:-digecom}_restore_test
  WORK=$TARGET
fi

$COMPOSE cp "$SRC/db.dump" postgres:/tmp/digecom-restore.dump > /dev/null 2>&1
$PSQL -d postgres -c "DROP DATABASE IF EXISTS \"$WORK\" WITH (FORCE)" -c "CREATE DATABASE \"$WORK\"" > /dev/null
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$WORK" --no-owner --no-privileges \
  --exit-on-error /tmp/digecom-restore.dump
$COMPOSE exec -T postgres rm -f /tmp/digecom-restore.dump
log "base restaurée dans « $WORK »"

STATUS=0
while IFS='=' read -r table want; do
  # < /dev/null : sinon « docker compose exec » lirait la suite du manifeste.
  got=$($PSQL -At -d "$WORK" -c "SELECT count(*) FROM \"$table\"" < /dev/null)
  if [ "$got" = "$want" ]; then echo "  OK     $table : $got"; else echo "  ÉCART  $table : $got (attendu $want)"; STATUS=1; fi
done < "$SRC/manifest.txt"
[ "$STATUS" = 0 ] || { log "ÉCHEC : comptages différents"; exit 4; }

if [ "$MODE" != "--production" ]; then
  $PSQL -d postgres -c "DROP DATABASE \"$WORK\" WITH (FORCE)" > /dev/null
  log "test réussi : sauvegarde conforme au manifeste ; base temporaire supprimée"
  exit 0
fi

# Production : bascule de la base, puis fichiers, puis redémarrage (migrate repose les droits).
OLD=${TARGET}_avant_$(date +%Y%m%d%H%M%S)
$PSQL -d postgres -c "ALTER DATABASE \"$TARGET\" RENAME TO \"$OLD\"" \
  -c "ALTER DATABASE \"$WORK\" RENAME TO \"$TARGET\"" > /dev/null
log "base basculée ; ancienne base conservée sous « $OLD » (à supprimer plus tard)"
for b in products proofs documents; do
  [ -d "$SRC/files/$b" ] || continue
  docker run --rm --network "${PROJECT}_default" -e HOME=/tmp \
    -e "MC_HOST_local=http://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@minio:9000" \
    -v "$SRC/files:/in:ro" "$MC_IMAGE" mirror --quiet --overwrite "/in/$b" "local/$b" > /dev/null
done
log "fichiers restaurés"
$COMPOSE up -d
log "terminé"
