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
  seedCategorias(inst);
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

function createTables(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','ambos'))
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
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
}

function seedCategorias(d) {
  const count = d.prepare('SELECT COUNT(*) as c FROM categorias').get();
  if (count.c === 0) {
    const insert = d.prepare('INSERT OR IGNORE INTO categorias (nome, tipo) VALUES (?, ?)');
    const items = [
      ['Salário', 'receita'], ['Freelance', 'receita'], ['Investimentos', 'receita'],
      ['Aluguel', 'despesa'], ['Água', 'despesa'], ['Luz', 'despesa'],
      ['Internet', 'despesa'], ['Telefone', 'despesa'], ['Alimentação', 'despesa'],
      ['Transporte', 'despesa'], ['Saúde', 'despesa'], ['Educação', 'despesa'],
      ['Lazer', 'despesa'], ['Assinaturas', 'despesa'], ['Seguros', 'despesa'],
      ['Impostos', 'despesa'], ['Outros', 'ambos']
    ];
    for (const [nome, tipo] of items) insert.run(nome, tipo);
  }
}

module.exports = { initDatabase, db };
