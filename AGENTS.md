# AGENTS.md

Controle financeiro pessoal (Node/Express, UI em português). Requer login via Google OAuth — não há login por senha.

## REGRAS DE SEGURANÇA (ABSOLUTAS — NUNCA VIOLAR)

### 1. NUNCA apague, drop ou modifique dados de produção sem:
1. Perguntar ao usuário e receber confirmação explícita
2. Rodar o script de backup antes: `./scripts/backup.sh [motivo]`
3. Confirmar que o backup foi criado com sucesso

### 2. NUNCA pare ou remova containers de produção sem:
- Confirmação explícita do usuário
- Motivo claro e documentado
- Backup prévio do banco de dados

### 3. NUNCA rode `docker compose down`, `docker rm`, `docker stop` em containers de produção
- Produção = `easymoney-easymoney-1` na máquina do servidor (`contas.tvtupi.com.br`)
- Só o usuário deve gerenciar containers de produção
- ERRO ANTERIOR: um agente parou o container de produção achando que era local — isso perdeu dados reais do usuário

### 4. NUNCA modifique o schema do banco (CREATE TABLE, ALTER TABLE, DROP TABLE) sem:
- Backup obrigatório antes
- Testar a migração em local primeiro
- Confirmação do usuário

### 5. SEMPRE confirme o ambiente antes de agir
- Pergunte: "Isso é em produção ou local?"
- Verifique com `docker ps` onde o container está rodando
- Nunca assuma que o erro é do servidor se pode ser local

### Script de backup
- `./scripts/backup.sh [motivo]` cria `data/backups/financeiro_[motivo]_[timestamp].db`
- Mantém os últimos 20 backups automaticamente; verifica integridade antes e depois
- NUNCA exclua arquivos de `data/backups/` manualmente

## Comandos
- `npm start` e `npm run dev` são idênticos: ambos rodam `node server.js`.
- Não há testes, lint, formatter ou typecheck configurados. Verificação é manual (API/curl ou UI).
- `docker compose up -d` sobe em **localhost:3002** por padrão (compose mapeia `${PORT:-3002}:${PORT:-3002}`; defina `PORT=xxxx` no ambiente ou em `.env` para usar outra porta).

## Arquitetura
- `server.js` inicia `initDatabase()` e só então `listen`. Todas as rotas `/api/*` e páginas passam por `ensureAuth` (auth.js): não autenticado → `401` em JSON ou redirect para `/login.html`.
- **Autenticação:** única opção é Google OAuth 2.0 (`passport` + `passport-google-oauth20` + `express-session`). Sem credenciais Google configuradas, `/auth/google` retorna 503 e o sistema fica inacessível. Não há cadastro/registro: usuários precisam existir na tabela `usuarios` (o primeiro vira `admin` via `ensureAdminUser`); novos usuários são criados por um admin em `/api/admin`.
- `config.js` carrega `config.json` (gitignored) com overrides de env: `PORT`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `SMTP_*`. Template em `config.example.json`. Sem `google.clientID/Secret` o login é impossível.
- Banco: `sql.js` (SQLite WASM em memória) persistido em `data/financeiro.db`. `docker-compose.yml` faz bind mount de `./data:/app/data` e `./config.json:/app/config.json`, então os arquivos do host SÃO os dados vivos. `initDatabase()` faz auto-backup em `data/backups/` a cada startup e roda migrações idempotentes.
- **Importante sobre persistência:** sql.js só grava em disco quando `db.persist()` é chamado — não é automático por escrita. Todas as rotas de escrita em `routes/*.js` (contas a pagar/receber, categorias, admin) DEVEM chamar `db.persist()` logo após o(s) `.run()`, antes do `res.json`. Já houve um bug histórico em que as rotas de contas a pagar/receber nunca persistiam, causando perda de dados a cada restart do container — se adicionar uma rota de escrita nova, não esqueça o `persist()`. O auto-backup de startup NÃO substitui isso: ele só copia o que já está em disco.
- Rotas em `routes/*.js` montadas em `/api/contas-pagar`, `/api/contas-receber`, `/api/dashboard`, `/api/categorias`, `/api/relatorios`, `/api/admin`. Frontend estático em `public/`.
- `db` (database.js) é um Proxy que lança se usado antes de `initDatabase()` resolver.

## docker-compose.yml É o deploy de PRODUÇÃO
- Tem labels `VIRTUAL_HOST=contas.tvtupi.com.br`, `LETSENCRYPT_HOST` e redes `tvplay-web_default` (nginx-proxy). Rodar localmente é OK para teste, mas o arquivo representa produção.
- `GOOGLE_CALLBACK_URL` vem de env com default de produção. **Para teste local**, suba com: `GOOGLE_CALLBACK_URL=http://localhost:3002/auth/google/callback docker compose up -d`.
- O client OAuth usado é de produção. Para login local, a URI `http://localhost:3002/auth/google/callback` precisa estar em "Authorized redirect URIs" no Google Cloud Console.
- Atenção: se a máquina definir `GOOGLE_CALLBACK_URL` no ambiente, a versão atual do compose passa a honrar esse valor (antes era fixo). Confirme que está correto ou ausente.

## Gotchas / segurança
- `config.json` e `.env` contêm segredos e são gitignored — nunca os comite.
- Não apague `data/backups/` (rotação automática dos últimos 20). `scripts/backup.sh` existe para backups sob demanda.
- Não pare/remova containers de produção (`contas.tvtupi.com.br`). Este repo roda localmente em `bolais-VirtualBox`.
- Sem `usuarios` no banco não há login possível — sempre garanta um admin (seed ou via `/api/admin`).
- `node_modules` pode estar ausente no host (o container tem suas próprias deps); não confie em `npm ci` do host sem revisar o `package.json`.
