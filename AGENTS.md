# Regras de Segurança — EasyMoney

## REGRAS ABSOLUTAS (NUNCA VIOLAR)

### 1. NUNCA apague, drop ou modifique dados de produção sem:
1. **PERGUNTAR AO USUÁRIO** e receber confirmação explícita
2. **RODAR O SCRIPT DE BACKUP** antes: `./scripts/backup.sh [motivo]`
3. **CONFIRMAR** que o backup foi criado com sucesso

### 2. NUNCA pare ou remova containers de produção sem:
- Confirmação explícita do usuário
- Motivo claro e documentado
- Backup prévio do banco de dados

### 3. NUNCA rode `docker compose down`, `docker rm`, `docker stop` em containers de produção
- Produção = `easymoney-easymoney-1` na máquina do servidor (contas.tvtupi.com.br)
- Só o usuário deve gerenciar containers de produção
- **ERRO ANTERIOR**: Um agente parou o container de produção achando que era local — isso perdeu dados reais do usuário

### 4. NUNCA modifique o schema do banco (CREATE TABLE, ALTER TABLE, DROP TABLE) sem:
- Backup obrigatório antes
- Testar a migração em local primeiro
- Confirmação do usuário

### 5. SEMPRE confirme o ambiente antes de agir
- Pergunte: "Isso é em produção ou local?"
- Verifique: `docker ps` para ver onde o container está rodando
- Nunca assuma que o erro é do servidor se pode ser local

## Script de Backup
```
./scripts/backup.sh [motivo]
```
- Cria backup em `data/backups/financeiro_[motivo]_[timestamp].db`
- Mantém últimos 20 backups automaticamente
- Verifica integridade antes e depois da cópia

## Diretório de backups
- Local: `data/backups/`
- NUNCA excluir arquivos desta pasta manualmente

## Contato
- Servidor: contas.tvtupi.com.br (Docker + nginx-proxy)
- Usuário admin: bolais@videomart.com.br
