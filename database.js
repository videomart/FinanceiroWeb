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
  createTables(inst);
  migrateSchema(inst);
  seedDefaultClient(inst);
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

function createTables(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      dominio TEXT UNIQUE,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
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

    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','ambos')),
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      UNIQUE(nome, cliente_id)
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL CHECK(valor >= 0),
      data_vencimento DATE NOT NULL,
      data_pagamento DATE,
      valor_pago REAL,
      categoria_id INTEGER REFERENCES categorias(id),
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
      categoria_id INTEGER REFERENCES categorias(id),
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
  if (!hasColumn(d, 'categorias', 'cliente_id')) {
    d.exec("ALTER TABLE categorias ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)");
  }
  if (!hasColumn(d, 'contas_pagar', 'cliente_id')) {
    d.exec("ALTER TABLE contas_pagar ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)");
  }
  if (!hasColumn(d, 'contas_receber', 'cliente_id')) {
    d.exec("ALTER TABLE contas_receber ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)");
  }

  const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='categorias' AND name LIKE 'sqlite_autoindex%'").all();
  const hasOldUnique = idx.some(i => i.name.startsWith('sqlite_autoindex_categorias'));
  if (hasOldUnique && hasColumn(d, 'categorias', 'cliente_id')) {
    d.exec("PRAGMA foreign_keys = OFF");
    const cats = d.prepare('SELECT id, nome, tipo, cliente_id FROM categorias').all();
    d.exec("ALTER TABLE contas_pagar RENAME TO contas_pagar_old");
    d.exec("ALTER TABLE contas_receber RENAME TO contas_receber_old");
    d.exec("DROP TABLE categorias");
    d.exec(`CREATE TABLE categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','ambos')),
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      UNIQUE(nome, cliente_id)
    )`);
    d.prepare(`CREATE TABLE IF NOT EXISTS contas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL, valor REAL NOT NULL CHECK(valor >= 0),
      data_vencimento DATE NOT NULL, data_pagamento DATE, valor_pago REAL,
      categoria_id INTEGER REFERENCES categorias(id),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado','cancelado')),
      observacao TEXT, recorrente INTEGER NOT NULL DEFAULT 0, frequencia TEXT,
      codigo_barras TEXT, linha_digitavel TEXT, data_emissao DATE,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    )`).all();
    d.prepare(`CREATE TABLE IF NOT EXISTS contas_receber (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT NOT NULL, valor REAL NOT NULL CHECK(valor >= 0),
      data_vencimento DATE NOT NULL, data_recebimento DATE, valor_recebido REAL,
      categoria_id INTEGER REFERENCES categorias(id),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','recebido','atrasado','cancelado')),
      observacao TEXT, recorrente INTEGER NOT NULL DEFAULT 0, frequencia TEXT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    )`).all();
    const ins = d.prepare('INSERT INTO categorias (id, nome, tipo, cliente_id) VALUES (?, ?, ?, ?)');
    for (const c of cats) ins.run(c.id, c.nome, c.tipo, c.cliente_id || 1);
    d.exec("DROP TABLE IF EXISTS contas_pagar_old");
    d.exec("DROP TABLE IF EXISTS contas_receber_old");
    d.exec("PRAGMA foreign_keys = ON");
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
    d.exec("UPDATE categorias SET cliente_id = 1 WHERE cliente_id IS NULL");
    d.exec("UPDATE contas_pagar SET cliente_id = 1 WHERE cliente_id IS NULL");
    d.exec("UPDATE contas_receber SET cliente_id = 1 WHERE cliente_id IS NULL");
  }

  const insert = d.prepare('INSERT OR IGNORE INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)');
  const todosClientes = d.prepare("SELECT id FROM clientes").all();
  for (const cli of todosClientes) {
    for (const [nome, tipo] of CATEGORIAS_BASE) {
      insert.run(nome, tipo, cli.id);
    }
  }
}

module.exports = { initDatabase, db, CATEGORIAS_BASE };
