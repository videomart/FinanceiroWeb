const express = require('express');
const router = express.Router();
const { db } = require('../database');

const FREQ_DIAS = { diaria: 1, semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90, semestral: 180, anual: 365 };

function calcularProximoVencimento(dataAtual, frequencia) {
  const d = new Date(dataAtual + 'T12:00:00');
  const dias = FREQ_DIAS[frequencia] || 30;
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

function gerarProximaRecorrente(conta) {
  const novaData = calcularProximoVencimento(conta.data_vencimento, conta.frequencia);
  db.prepare(`INSERT INTO contas_pagar (descricao, valor, data_vencimento, categoria_id, observacao, recorrente, frequencia, codigo_barras, linha_digitavel)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
    conta.descricao, conta.valor, novaData, conta.categoria_id, conta.observacao,
    conta.frequencia, conta.codigo_barras, conta.linha_digitavel
  );
}

router.get('/', (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];
  if (status) { where = 'WHERE cp.status = ?'; params.push(status); }
  const rows = db.prepare(`SELECT cp.*, c.nome as categoria_nome
    FROM contas_pagar cp LEFT JOIN categorias c ON cp.categoria_id = c.id
    ${where} ORDER BY cp.data_vencimento ASC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM contas_pagar ' + where).get(...params).c;
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
});

router.get('/estatisticas', (req, res) => {
  const pendentes = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status='pendente'`).get();
  const atrasadas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status IN ('atrasado','pendente') AND data_vencimento < date('now')`).get();
  const pagas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor_pago),0) as total FROM contas_pagar WHERE status='pago'`).get();
  const proximas = db.prepare(`SELECT cp.*, c.nome as categoria_nome FROM contas_pagar cp LEFT JOIN categorias c ON cp.categoria_id = c.id WHERE cp.status='pendente' AND cp.data_vencimento BETWEEN date('now') AND date('now','+7 days') ORDER BY cp.data_vencimento`).all();
  const recorrentes = db.prepare(`SELECT COUNT(*) as quantidade FROM contas_pagar WHERE recorrente=1 AND status='pendente'`).get();
  res.json({ pendentes, atrasadas, pagas, proximas, recorrentes });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT cp.*, c.nome as categoria_nome FROM contas_pagar cp LEFT JOIN categorias c ON cp.categoria_id = c.id WHERE cp.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { descricao, valor, data_vencimento, categoria_id, observacao, recorrente, frequencia, codigo_barras, linha_digitavel, data_emissao } = req.body;
  if (!descricao || valor === undefined || !data_vencimento) {
    return res.status(400).json({ error: 'descricao, valor e data_vencimento são obrigatórios' });
  }
  const result = db.prepare(`INSERT INTO contas_pagar (descricao, valor, data_vencimento, categoria_id, observacao, recorrente, frequencia, codigo_barras, linha_digitavel, data_emissao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    descricao, valor, data_vencimento, categoria_id || null, observacao || null,
    recorrente ? 1 : 0, frequencia || null, codigo_barras || null, linha_digitavel || null, data_emissao || null
  );
  res.status(201).json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  const { descricao, valor, data_vencimento, data_pagamento, valor_pago, categoria_id, status, observacao, recorrente, frequencia, codigo_barras, linha_digitavel } = req.body;
  db.prepare(`UPDATE contas_pagar SET descricao=?, valor=?, data_vencimento=?, data_pagamento=?,
    valor_pago=?, categoria_id=?, status=?, observacao=?, recorrente=?, frequencia=?,
    codigo_barras=?, linha_digitavel=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    descricao ?? existing.descricao, valor ?? existing.valor,
    data_vencimento ?? existing.data_vencimento, data_pagamento ?? null,
    valor_pago ?? null, categoria_id ?? existing.categoria_id,
    status ?? existing.status, observacao ?? null,
    recorrente !== undefined ? (recorrente ? 1 : 0) : existing.recorrente,
    frequencia ?? existing.frequencia, codigo_barras ?? existing.codigo_barras,
    linha_digitavel ?? existing.linha_digitavel, req.params.id
  );
  res.json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id));
});

router.put('/:id/pagar', (req, res) => {
  const { data_pagamento, valor_pago } = req.body;
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  const hoje = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE contas_pagar SET status='pago', data_pagamento=?, valor_pago=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(data_pagamento || hoje, valor_pago || conta.valor, req.params.id);

  if (conta.recorrente && conta.frequencia) {
    gerarProximaRecorrente(conta);
  }
  res.json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(req.params.id);
  res.json({ message: 'Conta removida' });
});

module.exports = router;
