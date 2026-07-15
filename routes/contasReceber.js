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
  db.prepare(`INSERT INTO contas_receber (descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia, cliente_id)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
    conta.descricao, conta.valor, novaData, conta.categoria_nome, conta.observacao, conta.frequencia, conta.cliente_id
  );
}

router.get('/', (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const clienteId = req.user.clienteId;
  const offset = (page - 1) * limit;
  let whereRows = 'WHERE cr.cliente_id = ?';
  let whereTotal = 'WHERE cliente_id = ?';
  const params = [clienteId];
  if (status) { whereRows += ' AND cr.status = ?'; whereTotal += ' AND status = ?'; params.push(status); }
  const rows = db.prepare(`SELECT cr.*, cr.categoria_nome as categoria_nome
    FROM contas_receber cr
    ${whereRows} ORDER BY cr.data_vencimento ASC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
  const total = db.prepare('SELECT COUNT(*) as c FROM contas_receber ' + whereTotal).get(...params).c;
  res.json({ rows, total, page: Number(page), limit: Number(limit) });
});

router.get('/estatisticas', (req, res) => {
  const clienteId = req.user.clienteId;
  const pendentes = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_receber WHERE status='pendente' AND cliente_id=?`).get(clienteId);
  const atrasadas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor),0) as total FROM contas_receber WHERE status IN ('atrasado','pendente') AND data_vencimento < date('now') AND cliente_id=?`).get(clienteId);
  const recebidas = db.prepare(`SELECT COUNT(*) as quantidade, COALESCE(SUM(valor_recebido),0) as total FROM contas_receber WHERE status='recebido' AND cliente_id=?`).get(clienteId);
  const proximas = db.prepare(`SELECT cr.*, cr.categoria_nome as categoria_nome FROM contas_receber cr WHERE cr.status='pendente' AND cr.data_vencimento BETWEEN date('now') AND date('now','+7 days') AND cr.cliente_id=? ORDER BY cr.data_vencimento`).all(clienteId);
  res.json({ pendentes, atrasadas, recebidas, proximas });
});

router.get('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const row = db.prepare('SELECT cr.*, cr.categoria_nome as categoria_nome FROM contas_receber cr WHERE cr.id = ? AND cr.cliente_id = ?').get(req.params.id, clienteId);
  if (!row) return res.status(404).json({ error: 'Conta não encontrada' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia } = req.body;
  const clienteId = req.user.clienteId;
  if (!descricao || valor === undefined || !data_vencimento) {
    return res.status(400).json({ error: 'descricao, valor e data_vencimento são obrigatórios' });
  }
  const result = db.prepare(`INSERT INTO contas_receber (descricao, valor, data_vencimento, categoria_nome, observacao, recorrente, frequencia, cliente_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    descricao, valor, data_vencimento, categoria_nome || null, observacao || null,
    recorrente ? 1 : 0, frequencia || null, clienteId
  );
  db.persist();
  res.status(201).json(db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const existing = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  const { descricao, valor, data_vencimento, data_recebimento, valor_recebido, categoria_nome, status, observacao, recorrente, frequencia } = req.body;
  db.prepare(`UPDATE contas_receber SET descricao=?, valor=?, data_vencimento=?, data_recebimento=?,
    valor_recebido=?, categoria_nome=?, status=?, observacao=?, recorrente=?, frequencia=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=?`).run(
    descricao ?? existing.descricao, valor ?? existing.valor,
    data_vencimento ?? existing.data_vencimento, data_recebimento ?? null,
    valor_recebido ?? null, categoria_nome ?? existing.categoria_nome,
    status ?? existing.status, observacao ?? null,
    recorrente !== undefined ? (recorrente ? 1 : 0) : existing.recorrente,
    frequencia ?? existing.frequencia, req.params.id, clienteId
  );
  db.persist();
  res.json(db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id));
});

router.put('/:id/receber', (req, res) => {
  const { data_recebimento, valor_recebido } = req.body;
  const clienteId = req.user.clienteId;
  const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  const hoje = new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE contas_receber SET status='recebido', data_recebimento=?, valor_recebido=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=?`)
    .run(data_recebimento || hoje, valor_recebido || conta.valor, req.params.id, clienteId);

  if (conta.recorrente && conta.frequencia) {
    gerarProximaRecorrente(conta);
  }
  db.persist();
  res.json(db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const clienteId = req.user.clienteId;
  const existing = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND cliente_id = ?').get(req.params.id, clienteId);
  if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });
  db.prepare('DELETE FROM contas_receber WHERE id = ? AND cliente_id = ?').run(req.params.id, clienteId);
  db.persist();
  res.json({ message: 'Conta removida' });
});

module.exports = router;
