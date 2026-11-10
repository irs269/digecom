# Déployer Dig'eCom sur le VPS (pas à pas)

Cible : VPS Ubuntu 24.04 partagé, Docker Engine et Compose v2 (sans buildx), **Nginx de l'hôte** pour le HTTPS (Certbot), pare-feu UFW (22, 80, 443). Dig'eCom tourne dans son propre projet Compose (`digecom-prod`) et ne touche à aucune autre application.

Toutes les commandes se copient-collent **sur le serveur**. Remplace d'abord, partout dans ce document :

- `digecom.example.km` par le domaine du back-office ;
- `fichiers.digecom.example.km` par le sous-domaine des fichiers.

## 0. Ce qui tourne

```
Internet ──443──► Nginx (hôte, Certbot)
                    ├── digecom.example.km          → 127.0.0.1:3100 → web (Next.js) ──/api/*──► api:4000
                    └── fichiers.digecom.example.km → 127.0.0.1:9100 → minio:9000 (API S3, URL signées)

Réseau Docker interne « digecom-prod_default » (aucun port publié) :
  postgres:5432   redis:6379   minio:9000   api:4000
```

| Service | Rôle | Mémoire max |
| --- | --- | --- |
| `web` | Back-office Next.js (seul port publié avec MinIO : `127.0.0.1:3100`) | 256 Mo |
| `api` | API NestJS et jobs BullMQ dans le même processus | 448 Mo |
| `postgres` | Base de données | 384 Mo |
| `redis` | Files et cache, avec mot de passe | 96 Mo |
| `minio` | Fichiers (API S3 sur `127.0.0.1:9100`, console non publiée) | 256 Mo |
| `migrate` | Ponctuel : migrations, droits du rôle applicatif, `create-admin` | 512 Mo, le temps de la commande |
| `minio-ready`, `minio-init` | Ponctuels : création des buckets `products`, `proofs` et `documents` | — |

Les services permanents tiennent dans **1,4 Go**. Ports utilisés sur l'hôte : **3100** et **9100**, uniquement sur 127.0.0.1. Ils se changent dans `.env` avec `WEB_PORT` et `MINIO_PORT`.

Vérifie qu'ils sont libres :

```bash
sudo ss -ltnp | grep -E ':(3100|9100)\b' || echo "3100 et 9100 libres"
```

## 1. DNS

Deux enregistrements **A** vers l'IP du VPS : `digecom.example.km` et `fichiers.digecom.example.km`. Vérifie la résolution :

```bash
dig +short digecom.example.km fichiers.digecom.example.km
```

## 2. Récupérer le code

```bash
sudo mkdir -p /opt/digecom && sudo chown "$USER": /opt/digecom
git clone https://github.com/irs269/digecom.git /opt/digecom
cd /opt/digecom
git checkout main
```

## 3. Créer le fichier `.env`

```bash
cd /opt/digecom
cp .env.production.example .env
chmod 600 .env
# Génère tous les secrets d'un coup (valeurs hexadécimales, sûres dans les URL) :
sed -i \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
  -e "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$(openssl rand -hex 24)/" \
  -e "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$(openssl rand -hex 24)/" \
  -e "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$(openssl rand -hex 48)/" \
  -e "s/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=$(openssl rand -hex 10)/" \
  -e "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=$(openssl rand -hex 24)/" \
  -e "s/^TURN_SECRET=.*/TURN_SECRET=$(openssl rand -hex 32)/" \
  .env
# Domaines :
sed -i \
  -e "s#^WEB_ORIGIN=.*#WEB_ORIGIN=https://digecom.example.km#" \
  -e "s#^S3_PUBLIC_ENDPOINT=.*#S3_PUBLIC_ENDPOINT=https://fichiers.digecom.example.km#" \
  .env
grep -c A-GENERER .env   # doit afficher 0
# Push de l'application iPhone (PWA) : paire de clés VAPID, à générer une seule fois.
docker run --rm node:22-alpine npx -y web-push@3.6.7 generate-vapid-keys
# → recopier « Public Key » dans VAPID_PUBLIC_KEY et « Private Key » dans VAPID_PRIVATE_KEY.
```

Ne jamais changer les clés VAPID ensuite : les iPhone déjà abonnés ne recevraient plus de notifications.

L'API **refuse de démarrer**, avec un message explicite dans `docker compose logs api`, dans ces cas :
- un secret vaut encore `A-GENERER-…` ;
- `SWAGGER_ENABLED` ou `DEV_TOOLS_ENABLED` vaut `true` ;
- le cookie n'est pas `Secure` ;
- `WEB_ORIGIN` n'est pas en `https://`.

## 4. Construire les images

```bash
cd /opt/digecom
docker compose -f compose.prod.yml config --quiet && echo "configuration valide"
docker compose -f compose.prod.yml build
```

- Le premier build prend 10 à 20 minutes.
- Les Dockerfiles n'utilisent aucune fonctionnalité réservée à BuildKit : le builder classique suffit.
- Trois images sont produites : `digecom-prod-api` (sans CLI Prisma ni tsx), `digecom-prod-migrate` et `digecom-prod-web`.

## 5. Migrer la base

```bash
docker compose -f compose.prod.yml up -d postgres
docker compose -f compose.prod.yml run --rm migrate
```

Résultat attendu : `All migrations have been successfully applied`, puis `Droits appliqués au rôle digecom_app`.

Le rôle `digecom_app` sert à l'API :
- il n'a aucun droit de DDL ;
- il n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur `AuditLog`, `LedgerEntry`, `StockMovement`, `OrderEvent` et `SellerAllocation`.

Les migrations utilisent le propriétaire `POSTGRES_USER`.

## 6. Créer le premier administrateur

```bash
docker compose -f compose.prod.yml run --rm migrate pnpm --filter api create-admin
```

La commande demande le nom, le téléphone (+269…) et le mot de passe : saisie masquée, 10 caractères minimum, au moins une lettre et un chiffre. Elle crée :
- le compte **Administrateur général** ;
- les données de référence : 3 îles, 3 sites, paramètres par défaut.

Aucun compte fictif n'est créé. Le seed de démonstration (`pnpm --filter api seed`) est **refusé** quand `NODE_ENV=production`.

## 7. Lancer

```bash
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml ps
```

Tous les services permanents doivent être `running (healthy)` ou `running`. `migrate`, `minio-ready` et `minio-init` apparaissent `exited (0)` : c'est normal.

```bash
curl -fsS http://127.0.0.1:3100/api/health && echo
curl -fsS http://127.0.0.1:3100/api/ready && echo
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/connexion   # 200
```

## 8. Nginx (hôte)

### 8.1 Back-office

```bash
sudo tee /etc/nginx/sites-available/digecom.conf > /dev/null <<'NGINX'
# Dig'eCom – back-office (Next.js sur 127.0.0.1:3100 ; /api/* relayé par Next.js vers l'API).
server {
    listen 80;
    listen [::]:80;
    server_name digecom.example.km;

    # Import de contacts (CSV / Excel jusqu'à 5 Mo, encodés en base64).
    client_max_body_size 10m;

    # En-têtes de sécurité (l'API et Next.js en posent aussi).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # REMPLACE (et non complète) l'en-tête du client : impossible d'usurper une IP.
        # Avec TRUST_PROXY=2, l'API retient cette adresse pour la limite de connexion.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Connection        "";
        proxy_read_timeout 120s;
        # Gros fichiers JavaScript (application /app : plus de 1 Mo) : jamais de fichier
        # temporaire Nginx. Sinon, si /var/lib/nginx n'est pas inscriptible, la réponse est
        # coupée en cours de route et l'application reste sur une page blanche.
        proxy_max_temp_file_size 0;
    }

    # Compression : l'application /app passe de 1,1 Mo à environ 300 Ko.
    gzip on;
    gzip_proxied any;
    gzip_min_length 1024;
    gzip_types application/javascript text/css application/json image/svg+xml;

    # Flux temps réel de l'application (appels, statuts) : comme les notifications.
    location /api/calls/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    # Notifications temps réel (SSE) : pas de mise en tampon, connexion longue.
    location /api/notifications/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
NGINX
```

### 8.2 Fichiers (MinIO, URL pré-signées)

La signature d'une URL pré-signée porte sur l'en-tête `Host`. Nginx doit donc transmettre `Host` **tel quel**, c'est-à-dire `fichiers.digecom.example.km`, la valeur de `S3_PUBLIC_ENDPOINT`.

```bash
sudo tee /etc/nginx/sites-available/digecom-fichiers.conf > /dev/null <<'NGINX'
# Dig'eCom – fichiers (API S3 de MinIO sur 127.0.0.1:9100). Console MinIO non exposée.
server {
    listen 80;
    listen [::]:80;
    server_name fichiers.digecom.example.km;

    # Photos produits (5 Mo maximum chacune, puis compressées en WebP), preuves, exports.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_http_version 1.1;
        # Indispensable : la signature des URL est calculée avec cet en-tête.
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
        # Envois directs vers MinIO, sans mise en tampon.
        proxy_request_buffering off;
        proxy_buffering off;
        chunked_transfer_encoding off;
        proxy_read_timeout 300s;
    }
}
NGINX
```

### 8.3 Activer, puis HTTPS avec Certbot

```bash
sudo ln -s /etc/nginx/sites-available/digecom.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/digecom-fichiers.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d digecom.example.km -d fichiers.digecom.example.km --redirect
sudo nginx -t && sudo systemctl reload nginx
```

Certbot ajoute les blocs `listen 443 ssl` et la redirection HTTP → HTTPS. Le renouvellement automatique est déjà assuré par le timer `certbot.timer` des autres applications.

## 9. Vérifications

```bash
cd /opt/digecom
docker compose -f compose.prod.yml ps
curl -fsS https://digecom.example.km/api/health && echo
curl -fsS https://digecom.example.km/api/ready && echo        # db, migrations, redis, storage : up
curl -sI https://digecom.example.km/connexion | grep -iE '^HTTP|strict-transport|x-frame|content-security'
# Aucun port Dig'eCom ouvert sur l'extérieur (uniquement 127.0.0.1) :
sudo ss -ltnp | grep -E ':(3100|9100)\b'
```

Dans le navigateur :
1. Ouvre `https://digecom.example.km`, connecte-toi avec l'administrateur.
2. Recharge la page : la session est conservée (cookie `Secure` sous HTTPS).
3. Catalogues → ajoute une photo à un produit : elle s'affiche depuis `https://fichiers.digecom.example.km/…`.
4. Teste la page sur <https://securityheaders.com>.

**Limite de connexion par IP** : 5 essais manqués pour un téléphone bloquent ce téléphone **depuis cette IP** pendant 15 minutes, sans bloquer les autres visiteurs. C'est vrai quand Nginx remplace `X-Forwarded-For` par `$remote_addr` et que `TRUST_PROXY=2` (§8.1).

## 10. Mise à jour

```bash
cd /opt/digecom
./scripts/backup.sh                                   # sauvegarde avant mise à jour
git pull
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$(git rev-parse --short HEAD)/" .env
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml run --rm migrate   # migrations (additives) + droits
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml ps
# Anciennes images Dig'eCom uniquement (jamais celles des autres applications) :
docker images 'digecom-prod-*' --format '{{.Repository}}:{{.Tag}}' | grep -v ":$(git rev-parse --short HEAD)$" | xargs -r docker rmi
```

**Retour arrière** : remets l'ancien commit dans `IMAGE_TAG`, puis lance `git checkout <commit>`, `build` et `up -d`. Les images déjà construites sont réutilisées. Les migrations étant additives, l'ancienne version accepte le schéma plus récent.

## 11. Sauvegardes

### 11.1 Sauvegarde automatique chaque nuit

```bash
sudo mkdir -p /var/backups/digecom && sudo chown "$USER": /var/backups/digecom
chmod +x /opt/digecom/scripts/backup.sh /opt/digecom/scripts/restore.sh
/opt/digecom/scripts/backup.sh                         # premier essai à la main
( crontab -l 2>/dev/null; echo '15 2 * * * cd /opt/digecom && ./scripts/backup.sh >> /var/log/digecom-backup.log 2>&1' ) | crontab -
sudo touch /var/log/digecom-backup.log && sudo chown "$USER": /var/log/digecom-backup.log
```

Chaque nuit à 02:15 (heure du serveur), le script crée `/var/backups/digecom/AAAA-MM-JJ_HHMMSS/` avec :
- `db.dump` : `pg_dump` compressé ;
- `manifest.txt` : nombre de commandes, écritures, entrées d'audit, utilisateurs…, comptés dans le **même instantané** que le dump ;
- `files/` : copie des buckets ;
- `SHA256SUMS` : empreintes de tous les fichiers.

Il garde les **14 derniers jours** (`BACKUP_KEEP_DAYS`).

**Copie hors du serveur, fortement conseillée.** Le même `rsync` toutes les nuits vers une autre machine ou un stockage externe :

```bash
rsync -a --delete /var/backups/digecom/ sauvegarde@autre-serveur:/srv/digecom/
```

### 11.2 Tester une restauration (chaque mois)

```bash
cd /opt/digecom
./scripts/restore.sh "$(ls -1d /var/backups/digecom/20* | tail -1)"
```

Le script :
1. vérifie les empreintes ;
2. restaure dans une base temporaire `digecom_restore_test` ;
3. compare chaque comptage au manifeste (`OK` ou `ÉCART`) ;
4. supprime la base temporaire.

La production n'est jamais touchée. Code de sortie : `0` en cas de succès.

### 11.3 Restaurer la production

```bash
cd /opt/digecom
./scripts/backup.sh                                     # état actuel, au cas où
./scripts/restore.sh /var/backups/digecom/AAAA-MM-JJ_HHMMSS --production
```

1. Le script demande de taper `RESTAURER`, puis arrête le web et l'API.
2. Il restaure dans une base temporaire et vérifie les comptages.
3. Il bascule la base : l'ancienne est gardée sous `digecom_avant_<date>`.
4. Il recopie les fichiers et relance tout ; `migrate` repose les droits du rôle applicatif.

Supprime l'ancienne base quelques jours plus tard :

```bash
docker compose -f compose.prod.yml exec postgres psql -U digecom -d postgres -c 'DROP DATABASE "digecom_avant_<date>"'
```

## 12. Commandes utiles

```bash
cd /opt/digecom
docker compose -f compose.prod.yml logs -f --tail=200 api        # journaux JSON de l'API
docker compose -f compose.prod.yml restart api web               # redémarrage sans perte
docker compose -f compose.prod.yml exec postgres psql -U digecom digecom
docker stats --no-stream $(docker compose -f compose.prod.yml ps -q)   # mémoire réelle
```

## 13. Choix techniques

- **Jobs BullMQ dans l'API** : abonnements, relevés, alertes livreurs, invendus, campagnes et exports volumineux tournent dans le processus de l'API (`PROCESS_ROLE=all`). Avec une seule instance et peu de charge, c'est le plus économe en mémoire. Un worker dédié reste possible sans modifier le code : un second service avec la même image, `command: ["node", "dist/worker.js"]` et `PROCESS_ROLE=worker` ; l'API passe alors en `PROCESS_ROLE=api`. Chaque job est idempotent. Un échec est notifié aux administrateurs et visible dans `GET /api/ops/metrics`.
- **IP réelle** : Nginx remplace `X-Forwarded-For`, Next.js transmet la requête, et l'API fait confiance à exactement 2 proxys (`TRUST_PROXY=2`).
- **Rôle PostgreSQL applicatif** : les triggers append-only restent en place. Le rôle n'a en plus aucun droit d'`UPDATE`/`DELETE` sur les tables d'audit et le grand livre.
- **Secrets** : uniquement dans `.env` (mode 600, hors dépôt). Pour en changer un : nouvelle valeur dans `.env`, puis `run --rm migrate` (pour `APP_DB_PASSWORD`) et `up -d`. `POSTGRES_PASSWORD` se change aussi dans la base (`ALTER ROLE digecom PASSWORD '…'`).
