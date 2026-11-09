#!/bin/sh
# Sauvegarde Dig'eCom (production) – à lancer sur l'hôte, depuis /opt/digecom, par cron :
#   15 2 * * * cd /opt/digecom && ./scripts/backup.sh >> /var/log/digecom-backup.log 2>&1
#
# Crée BACKUP_DIR/AAAA-MM-JJ_HHMMSS/ avec :
#   - db.dump          pg_dump format custom (compressé), restaurable par pg_restore ;
#   - manifest.txt     nombres de lignes clés (commandes, écritures, audit…) pris dans le MÊME
#                      instantané que le dump : la restauration les vérifie ;
#   - files/<bucket>   copie des buckets MinIO (products, proofs, documents) ;
#   - SHA256SUMS       empreintes de tous les fichiers.
# Garde les BACKUP_KEEP_DAYS derniers jours (14 par défaut).
set -eu

cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env}
[ -f "$ENV_FILE" ] || { echo "Fichier $ENV_FILE introuvable"; exit 1; }
# shellcheck disable=SC1090
set -a; . "./$ENV_FILE"; set +a

COMPOSE="docker compose -f compose.prod.yml --env-file $ENV_FILE"
PROJECT=${COMPOSE_PROJECT_NAME:-digecom-prod}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/digecom}
KEEP=${BACKUP_KEEP_DAYS:-14}
MC_IMAGE=chainguard/minio-client@sha256:7e80e77f8c949810d0eaead1120e28c63f913ff96ae7f78a8e4cd3c1e2f0623f
STAMP=$(date +%Y-%m-%d_%H%M%S)
DEST="$BACKUP_DIR/$STAMP"

log() { echo "$(date '+%F %T') [backup] $*"; }

mkdir -p "$DEST/files"
chmod 700 "$BACKUP_DIR" "$DEST"
log "début → $DEST"

# 1. Base : instantané exporté partagé par les comptages et pg_dump (cohérence exacte).
$COMPOSE exec -T postgres sh -s > "$DEST/manifest.txt" 2> "$DEST/.pg.err" <<'EOS' || { cat "$DEST/.pg.err"; exit 1; }
set -eu
W=$(mktemp -d)
mkfifo "$W/in"
psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$W/in" > "$W/out" &
exec 3> "$W/in"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 'SNAP:' || pg_export_snapshot();" >&3
i=0; until grep -q '^SNAP:' "$W/out" 2>/dev/null; do i=$((i+1)); [ $i -lt 300 ] || exit 1; sleep 0.1; done
SNAP=$(grep '^SNAP:' "$W/out" | cut -d: -f2)
for t in Order OrderItem LedgerEntry AuditLog User StockMovement Settlement Product; do
  echo "SELECT 'COUNT:$t=' || count(*) FROM \"$t\";" >&3
done
i=0; until [ "$(grep -c '^COUNT:' "$W/out")" -ge 8 ]; do i=$((i+1)); [ $i -lt 600 ] || exit 1; sleep 0.1; done
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6 --no-owner --no-privileges \
  --snapshot="$SNAP" -f /tmp/digecom-backup.dump
echo "COMMIT;" >&3; exec 3>&-; wait
grep '^COUNT:' "$W/out" | cut -d: -f2-
rm -rf "$W"
EOS
$COMPOSE cp postgres:/tmp/digecom-backup.dump "$DEST/db.dump" > /dev/null
$COMPOSE exec -T postgres rm -f /tmp/digecom-backup.dump
rm -f "$DEST/.pg.err"
[ -s "$DEST/db.dump" ] || { log "ÉCHEC : dump vide"; exit 1; }
log "base : $(du -h "$DEST/db.dump" | cut -f1) ; $(tr '\n' ' ' < "$DEST/manifest.txt")"

# 2. Fichiers MinIO (client mc sur le réseau interne du projet, aucun port nécessaire).
for b in products proofs documents; do
  docker run --rm --network "${PROJECT}_default" --user "$(id -u):$(id -g)" \
    -e "MC_HOST_local=http://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@minio:9000" \
    -v "$DEST/files:/out" "$MC_IMAGE" mirror --quiet "local/$b" "/out/$b" > /dev/null
done
log "fichiers : $(find "$DEST/files" -type f | wc -l) objet(s)"

# 3. Empreintes, puis rotation (dossiers datés de plus de KEEP jours).
(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | xargs -0 sha256sum > SHA256SUMS)
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_*' -mtime +"$((KEEP - 1))" \
  -exec rm -rf {} + -exec echo "$(date '+%F %T') [backup] rotation : {} supprimé" \;
log "terminé"
