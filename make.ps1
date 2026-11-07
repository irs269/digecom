# Dig'eCom - equivalent Windows du Makefile (memes cibles).
# Usage : ./make.ps1 up | down | logs | migrate | seed | test | e2e | lint | psql | build | reset
param([Parameter(Position = 0)][string]$Target = 'help')

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Invoke-Step([string]$Cmd) {
  Write-Host "> $Cmd" -ForegroundColor DarkGray
  Invoke-Expression $Cmd
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

switch ($Target) {
  'up' {
    if (-not (Test-Path .env)) {
      Write-Host "Fichier .env absent : lance d'abord  Copy-Item .env.example .env" -ForegroundColor Red
      exit 1
    }
    Invoke-Step 'docker compose up -d --build --wait api web'
    Write-Host 'Web : http://localhost:3000  -  API : http://localhost:4000/api/docs'
  }
  'down'    { Invoke-Step 'docker compose down' }
  'logs'    { Invoke-Step 'docker compose logs -f --tail=100' }
  'migrate' { Invoke-Step 'docker compose exec api pnpm --filter api migrate' }
  'seed'    { Invoke-Step 'docker compose exec api pnpm --filter api seed' }
  'test'    { Invoke-Step 'docker compose exec api pnpm test' }
  'e2e' {
    # Remet a zero les compteurs d'essais de connexion (limite 5 / 15 min par IP + telephone).
    docker compose exec -T redis sh -c "redis-cli --scan --pattern 'login:attempts:*' | xargs -r redis-cli del > /dev/null"
    Invoke-Step 'docker compose --profile e2e run --rm e2e'
  }
  'lint'    { Invoke-Step 'docker compose exec api pnpm lint' }
  'psql'    { Invoke-Step "docker compose exec postgres sh -c 'psql -U `"`$POSTGRES_USER`" `"`$POSTGRES_DB`"'" }
  'build' {
    Invoke-Step 'docker build -f apps/api/Dockerfile --target prod -t digecom-api:local .'
    Invoke-Step 'docker build -f apps/web/Dockerfile --target prod -t digecom-web:local .'
  }
  'reset' {
    $answer = Read-Host "Cette commande SUPPRIME la base, Redis, MinIO et les node_modules Docker. Taper 'oui' pour confirmer"
    if ($answer -ne 'oui') { Write-Host 'Annule.'; exit 1 }
    Invoke-Step 'docker compose --profile e2e down -v --remove-orphans'
  }
  default {
    Write-Host 'Cibles : up, down, logs, migrate, seed, test, e2e, lint, psql, build, reset'
  }
}
