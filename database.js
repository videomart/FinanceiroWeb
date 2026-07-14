const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'financeiro.db');
let dbInstance = null;

class Statement {
  constructor(sqlDb, sql) { this.sqlDb = sqlDb; this.sql = sql; }
  all(...params) {
    const stmt = this.sqlDb.prepare(this.sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  get(...params) {
    const rows = this.all(...params);
    return rows.length > 0 ? rows[0] : undefined;
  }
  run(...params) {
    this.sqlDb.run(this.sql, params);
    const result = this.sqlDb.exec("SELECT last_insert_rowid() as id, changes() as c");
    const row = result.length > 0 ? result[0].values[0] : [0, 0];
    return { lastInsertRowid: Number(row[0]), changes: Number(row[1]) };
  }
}

class Database {
  constructor(sqlDb) { this.sqlDb = sqlDb; }
  prepare(sql) { return new Statement(this.sqlDb, sql); }
  exec(sql) { this.sqlDb.run(sql); }
  transaction(fn) {
    return (...args) => {
      this.sqlDb.run('BEGIN');
      try {
        const result = fn(...args);
        this.sqlDb.run('COMMIT');
        return result;
      } catch (e) {
        this.sqlDb.run('ROLLBACK');
        throw e;
      }
    };
  }
  close() { this.sqlDb.close(); }
  persist() {
    const data = this.sqlDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

async function initDatabase() {
  if (dbInstance) return;
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }
  sqlDb.run('PRAGMA foreign_keys = ON');
  const inst = new Database(sqlDb);
  migrateToNomeSchema(inst);
  createTables(inst);
  migrateSchema(inst);
  seedDefaultClient(inst);
  deduplicateCategorias(inst);
  ensureAdminUser(inst);
  inst.persist();
  dbInstance = inst;
}

const db = new Proxy({}, {
  get(target, prop) {
    if (!dbInstance) {
      if (prop === 'then') return undefined;
      throw new Error('Database not initialized');
    }
    const val = dbInstance[prop];
    return typeof val === 'function' ? val.bind(dbInstance) : val;
  }
});

function hasColumn(d, table, column) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

function tableHasPK(d, table) {
  const info = d.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(c => c.pk > 0);
}

function migrateToNomeSchema(d) {
  const hasCategorias = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categorias'").all();
  if (hasCategorias.length === 0) return;

  const hasOldId = hasColumn(d, 'categorias', 'id');
  if (!hasOldId) return;

  console.log('[DB] Migrando categorias para schema por nome...');

  d.exec('PRAGMA foreign_keys = OFF');

  const oldCats = d.prepare('SELECT id, nome, tipo, cliente_id FROM categorias').all();
  const catMap = {};
  for (const c of oldCats) {
    catMap[c.id] = c.nome;
  }

  const hasPagarCatId = hasColumn(d, 'contas_pagar', 'categoria_id');
  let oldPagar = [];
  if (hasPagarCatId) {
    oldPagar = d.prepare('SELECT id, categoria_id FROM contas_pagar WHERE categoria_id IS NOT NULL').all();
  }

  const hasReceberCatId = hasColumn(d, 'contas_receber', 'categoria_id');
  let oldReceber = [];
  if (hasReceberCatId) {
    oldReceber = d.prepare('SELECT id, categoria_id FROM contas_receber WHERE categoria_id IS NOT NULL').all();
  }

  d.exec('DROP TABLE IF EXISTS contas_pagar_old');
  d.exec('DROP TABLE IF EXISTS contas_receber_old');
  d.exec('DROP TABLE IF EXISTS categorias_old');

  d.exec('ALTER TABLE contas_pagar RENAME TO contas_pagar_old');
  d.exec('ALTER TABLE contas_receber RENAME TO contas_receber_old');
  d.exec('ALTER TABLE categorias RENAME TO categorias_old');

  d.exec(`CREATE TABLE categorias (
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','ambos')),
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    PRIMARY KEY (nome, cliente_id)
  )`);

  d.exec(`CREATE TABLE contas_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL CHECK(valor >= 0),
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    valor_pago REAL,
    categoria_nome TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado','cancelado')),
    observacao TEXT,
    recorrente INTEGER NOT NULL DEFAULT 0,
    frequencia TEXT,
    codigo_barras TEXT,
    linha_digitavel TEXT,
    data_emissao DATE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  d.exec(`CREATE TABLE contas_receber (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL CHECK(valor >= 0),
    data_vencimento DATE NOT NULL,
    data_recebimento DATE,
    valor_recebido REAL,
    categoria_nome TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','recebido','atrasado','cancelado')),
    observacao TEXT,
    recorrente INTEGER NOT NULL DEFAULT 0,
    frequencia TEXT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  const insertCat = d.prepare('INSERT OR IGNORE INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)');
  for (const c of oldCats) {
    insertCat.run(c.nome, c.tipo, c.cliente_id || 1);
  }

  const pagarCols = d.prepare('PRAGMA table_info(contas_pagar_old)').all().map(c => c.name);
  const insertPagarCols = ['id', 'descricao', 'valor', 'data_vencimento', 'data_pagamento', 'valor_pago', 'categoria_nome', 'status', 'observacao', 'recorrente', 'frequencia', 'codigo_barras', 'linha_digitavel', 'data_emissao', 'cliente_id', 'created_at', 'updated_at'].filter(c => pagarCols.includes(c) || c === 'categoria_nome');
  const oldPagarRows = d.prepare(`SELECT * FROM contas_pagar_old`).all();
  const insPagar = d.prepare(`INSERT INTO contas_pagar (${insertPagarCols.join(',')}) VALUES (${insertPagarCols.map(() => '?').join(',')})`);
  for (const row of oldPagarRows) {
    const values = insertPagarCols.map(col => {
      if (col === 'categoria_nome') {
        return row.categoria_id ? (catMap[row.categoria_id] || null) : null;
      }
      return row[col] !== undefined ? row[col] : null;
    });
    insPagar.run(...values);
  }

  const receberCols = d.prepare('PRAGMA table_info(contas_receber_old)').all().map(c => c.name);
  const insertReceberCols = ['id', 'descricao', 'valor', 'data_vencimento', 'data_recebimento', 'valor_recebido', 'categoria_nome', 'status', 'observacao', 'recorrente', 'frequencia', 'cliente_id', 'created_at', 'updated_at'].filter(c => receberCols.includes(c) || c === 'categoria_nome');
  const oldReceberRows = d.prepare(`SELECT * FROM contas_receber_old`).all();
  const insReceber = d.prepare(`INSERT INTO contas_receber (${insertReceberCols.join(',')}) VALUES (${insertReceberCols.map(() => '?').join(',')})`);
  for (const row of oldReceberRows) {
    const values = insertReceberCols.map(col => {
      if (col === 'categoria_nome') {
        return row.categoria_id ? (catMap[row.categoria_id] || null) : null;
      }
      return row[col] !== undefined ? row[col] : null;
    });
    insReceber.run(...values);
  }

  d.exec('DROP TABLE IF EXISTS contas_pagar_old');
  d.exec('DROP TABLE IF EXISTS contas_receber_old');
  d.exec('DROP TABLE IF EXISTS categorias_old');
  d.exec('PRAGMA foreign_keys = ON');

  console.log('[DB] Migração de categorias concluída: ' + oldCats.length + ' categorias migradas');
}

function createTables(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      dominio TEXT UNIQUE,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS categorias (
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','ambos')),
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      PRIMARY KEY (nome, cliente_id)
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      google_id TEXT UNIQUE,
      email TEXT NOT NULL,
      nome TEXT NOT NULL,
      avatar TEXT,
      papel TEXT NOT NULL DEFAULT 'usuario' CHECK(papel IN ('admin','usuario')),
      ativo INTEGER NOT NULL DEFAULT 1,
      ultimo_acesso DATETIME,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL CHECK(valor >= 0),
      data_vencimento DATE NOT NULL,
      data_pagamento DATE,
      valor_pago REAL,
      categoria_nome TEXT,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado','cancelado')),
      observacao TEXT,
      recorrente INTEGER NOT NULL DEFAULT 0,
      frequencia TEXT,
      codigo_barras TEXT,
      linha_digitavel TEXT,
      data_emissao DATE,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS contas_receber (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL CHECK(valor >= 0),
      data_vencimento DATE NOT NULL,
      data_recebimento DATE,
      valor_recebido REAL,
      categoria_nome TEXT,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','recebido','atrasado','cancelado')),
      observacao TEXT,
      recorrente INTEGER NOT NULL DEFAULT 0,
      frequencia TEXT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS notificacoes_enviadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      tipo_conta TEXT NOT NULL CHECK(tipo_conta IN ('pagar','receber')),
      conta_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      dias_antes INTEGER NOT NULL,
      enviado_em DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(cliente_id, tipo_conta, conta_id, usuario_id, dias_antes)
    );
  `);
}

function migrateSchema(d) {
  if (hasColumn(d, 'categorias', 'id') && tableHasPK(d, 'categorias')) {
    migrateToNomeSchema(d);
  }

  if (!hasColumn(d, 'categorias', 'tipo')) {
    d.exec("ALTER TABLE categorias ADD COLUMN tipo TEXT NOT NULL DEFAULT 'ambos' CHECK(tipo IN ('receita','despesa','ambos'))");
  }

  const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='categorias'").all();
  const hasUniqueIdx = idx.some(i => i.sql && i.sql.includes('UNIQUE'));
  if (hasUniqueIdx) {
    for (const i of idx) {
      if (i.sql && i.sql.includes('UNIQUE') && !i.sql.includes('PRIMARY')) {
        try { d.exec(`DROP INDEX IF EXISTS "${i.name}"`); } catch (e) {}
      }
    }
  }
}

function ensureAdminUser(d) {
  const adminCount = d.prepare("SELECT COUNT(*) as c FROM usuarios WHERE papel = 'admin'").get().c;
  if (adminCount === 0) {
    const firstUser = d.prepare("SELECT id FROM usuarios ORDER BY id ASC LIMIT 1").get();
    if (firstUser) {
      d.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?").run(firstUser.id);
      console.log('Primeiro usuário promovido a admin');
    }
  }
}

const CATEGORIAS_BASE = [
  ['Salário', 'receita'], ['Freelance', 'receita'], ['Investimentos', 'receita'],
  ['Aluguel', 'despesa'], ['Água', 'despesa'], ['Luz', 'despesa'],
  ['Internet', 'despesa'], ['Telefone', 'despesa'], ['Alimentação', 'despesa'],
  ['Transporte', 'despesa'], ['Saúde', 'despesa'], ['Educação', 'despesa'],
  ['Lazer', 'despesa'], ['Assinaturas', 'despesa'], ['Seguros', 'despesa'],
  ['Impostos', 'despesa'], ['Outros', 'ambos']
];

function seedDefaultClient(d) {
  let cliente = d.prepare("SELECT id FROM clientes WHERE id = 1").get();
  if (!cliente) {
    d.prepare("INSERT INTO clientes (id, nome, dominio) VALUES (1, 'Cliente Padrão', NULL)").run();
  }

  const insert = d.prepare('INSERT OR IGNORE INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)');
  const todosClientes = d.prepare("SELECT id FROM clientes").all();
  for (const cli of todosClientes) {
    for (const [nome, tipo] of CATEGORIAS_BASE) {
      insert.run(nome, tipo, cli.id);
    }
  }
}

function normalizeForDedup(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function deduplicateCategorias(d) {
  const clientes = d.prepare("SELECT DISTINCT cliente_id FROM categorias").all();
  let removed = 0;
  for (const { cliente_id } of clientes) {
    const cats = d.prepare("SELECT nome, tipo FROM categorias WHERE cliente_id = ?").all(cliente_id);
    const groups = {};
    for (const c of cats) {
      const key = normalizeForDedup(c.nome);
      if (!groups[key]) groups[key] = [];
      groups[key].push(c.nome);
    }
    for (const [key, names] of Object.entries(groups)) {
      if (names.length <= 1) continue;
      const canonical = names.reduce((best, n) => {
        if (n !== normalizeForDedup(n) && normalizeForDedup(n) === normalizeForDedup(best)) return n;
        return best;
      });
      for (const dup of names) {
        if (dup === canonical) continue;
        d.prepare("UPDATE contas_pagar SET categoria_nome = ? WHERE categoria_nome = ? AND cliente_id = ?").run(canonical, dup, cliente_id);
        d.prepare("UPDATE contas_receber SET categoria_nome = ? WHERE categoria_nome = ? AND cliente_id = ?").run(canonical, dup, cliente_id);
        d.prepare("DELETE FROM categorias WHERE nome = ? AND cliente_id = ?").run(dup, cliente_id);
        removed++;
      }
    }
  }
  if (removed > 0) console.log('[DB] ' + removed + ' categorias duplicadas (acentos) removidas');
}

module.exports = { initDatabase, db, CATEGORIAS_BASE };
