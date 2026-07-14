#!/bin/bash
# Backup automático do banco financeiro.db
# Uso: ./scripts/backup.sh [motivo]

set -e

DB_PATH="/home/ubuntu/projects/EasyMoney/data/financeiro.db"
BACKUP_DIR="/home/ubuntu/projects/EasyMoney/data/backups"
MOTIVO="${1:-backup-automatico}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/financeiro_${MOTIVO}_${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "ERRO: Banco não encontrado em $DB_PATH"
  exit 1
fi

# Verificar integridade antes de copiar
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "ERRO")
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERRO: Banco com integridade comprometida: $INTEGRITY"
  exit 1
fi

# Copiar usando .backup do sqlite3 para backup seguro (hot backup)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Verificar se o backup foi criado
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERRO: Falha ao criar backup"
  exit 1
fi

# Verificar integridade do backup
BACKUP_INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "ERRO")
if [ "$BACKUP_INTEGRITY" != "ok" ]; then
  echo "ERRO: Backup com integridade comprometida"
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "Backup criado: $BACKUP_FILE"

# Manter apenas os últimos 20 backups (limpar antigos)
cd "$BACKUP_DIR"
ls -t financeiro_*.db 2>/dev/null | tail -n +21 | xargs -r rm -f
REMAINING=$(ls financeiro_*.db 2>/dev/null | wc -l)
echo "Backups mantidos: $REMAINING"
