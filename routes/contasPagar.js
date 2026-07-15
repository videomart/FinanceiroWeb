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
  db.prepare(`INSERT INTO contas_pagar (descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia, codigo_barras, linha_digitavel, cliente_id)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(
    conta.descricao, conta.valor, novaData, conta.categoria_nome, conta.observacao,
    conta.frequencia, conta.codigo_barras, conta.linha_digitavel, conta.cliente_id
  );
}

router.get('/', (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const clienteId = req.user.clienteId;
  const offset = (page - 1) * limit;
  let whereRows = 'WHERE cp.cliente_id = ?';
  let whereTotal = 'WHERE cliente_id = ?';
  const params = [clienteId];
  if (status) { whereRows += ' AND cp.status = ?'; whereTotal += ' AND status = ?'; params.push(status); }
  const rows = db.prepare(`SELECT cp.*, cp.categoria_nome as categoria_nome
    FROM contas_pagar cp
    ${whereRows} ORDER BY cp.data_vencimento ASC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM contas_pagar ' + whereTotal).get(...params).c;
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
});

router.get('/estatisticas', (req, res) => {
  const clienteId = req.user.clienteId;
  const pendentes = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status='pendente' AND cliente_id=?`).get(clienteId);
  const atrasadas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status IN ('atrasado','pendente') AND data_vencimento < date('now') AND cliente_id=?`).get(clienteId);
  const pagas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor_pago),0) as total FROM contas_pagar WHERE status='pago' AND cliente_id=?`).get(clienteId);
  const proximas = db.prepare(`SELECT cp.*, cp.categoria_nome as categoria_nome FROM contas_pagar cp WHERE cp.status='pendente' AND cp.data_vencimento BETWEEN date('now') AND date('now','+7 days') AND cp.cliente_id=? ORDER BY cp.data_vencimento`).all(clienteId);
  const recorrentes = db.prepare(`SELECT COUNT(*) as quantidade FROM contas_pagar WHERE recorrente=1 AND status='pendente' AND cliente_id=?`).get(clienteId);
  res.json({ pendentes, atrasadas, pagas, proximas, recorrentes });
});

router.get('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const row = db.prepare('SELECT cp.*, cp.categoria_nome as categoria_nome FROM contas_pagar cp WHERE cp.id = ? AND cp.cliente_id = ?').get(req.params.id, clienteId);
  if (!row) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia, codigo_barras, linha_digitavel, data_emissao } = req.body;
  const clienteId = req.user.clienteId;
  if (!descricao || valor === undefined || !data_vencimento) {
    return res.status(400).json({ error: 'descricao, valor e data_vencimento são obrigatórios' });
  }
  const result = db.prepare(`INSERT INTO contas_pagar (descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia, codigo_barras, linha_digitavel, data_emissao, cliente_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    descricao, valor, data_vencimento, categoria_nome || null, observacao || null,
    recorrente ? 1 : 0, frequencia || null, codigo_barras || null, linha_digitavel || null, data_emissao || null,
    clienteId
  );
  db.persist();
  res.status(201).json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const existing = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  const { descricao, valor, data_vencimento, data_pagamento, valor_pago, categoria_nome, status, observacao, recorrente, frequencia, codigo_barras, linha_digitavel } = req.body;
  db.prepare(`UPDATE contas_pagar SET descricao=?, valor=?, data_vencimento=?, data_pagamento=?,
    valor_pago=?, categoria_nome=?, status=?, observacao=?, recorrente=?, frequencia=?,
    codigo_barras=?, linha_digitavel=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=?`).run(
    descricao ?? existing.descricao, valor ?? existing.valor,
    data_vencimento ?? existing.data_vencimento, data_pagamento ?? null,
    valor_pago ?? null, categoria_nome ?? existing.categoria_nome,
    status ?? existing.status, observacao ?? null,
    recorrente !== undefined ? (recorrente ? 1 : 0) : existing.recorrente,
    frequencia ?? existing.frequencia, codigo_barras ?? existing.codigo_barras,
    linha_digitavel ?? existing.linha_digitavel, req.params.id, clienteId
  );
  db.persist();
  res.json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id));
});

router.put('/:id/pagar', (req, res) => {
  const { data_pagamento, valor_pago } = req.body;
  const clienteId = req.user.clienteId;
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  const hoje = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE contas_pagar SET status='pago', data_pagamento=?, valor_pago=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=?`)
    .run(data_pagamento || hoje, valor_pago || conta.valor, req.params.id, clienteId);

  if (conta.recorrente && conta.frequencia) {
    gerarProximaRecorrente(conta);
  }
  db.persist();
  res.json(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const existing = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  db.prepare('DELETE FROM contas_pagar WHERE id = ? AND cliente_id = ?').run(req.params.id, clienteId);
  db.persist();
  res.json({ message: 'Conta removida' });
});

module.exports = router;
