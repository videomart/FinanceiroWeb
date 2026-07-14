const express = require('express');
const router = express.Router();
const { db } = require('../database');

const FREQ_LABELS = { diaria: 'Diária', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };

router.get('/previsao', (req, res) => {
  const { meses = 6 } = req.query;
  const clienteId = req.user.clienteId;
  const hoje = new Date();
  const previsoes = [];

  for (let i = 0; i < Number(meses); i++) {
    const mes = hoje.getMonth() + i;
    const ano = hoje.getFullYear() + Math.floor(mes / 12);
    const mesNum = (mes % 12) + 1;
    const mesStr = String(mesNum).padStart(2, '0');

    const aPagar = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar
      WHERE status='pendente' AND strftime('%Y-%m', data_vencimento)=? AND cliente_id=?`).get(`${ano}-${mesStr}`, clienteId);
    const aReceber = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber
      WHERE status='pendente' AND strftime('%Y-%m', data_vencimento)=? AND cliente_id=?`).get(`${ano}-${mesStr}`, clienteId);

    const saldo = aReceber.total - aPagar.total;
    previsoes.push({ mes: mesNum, ano, aPagar: aPagar.total, aReceber: aReceber.total, saldo });
  }

  res.json(previsoes);
});

router.get('/resumo-geral', (req, res) => {
  const clienteId = req.user.clienteId;
  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
  const anoAtual = new Date().getFullYear();

  const aPagarPendente = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status='pendente' AND cliente_id=?`).get(clienteId);
  const aPagarAtrasado = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE (status='atrasado' OR (status='pendente' AND data_vencimento < ?)) AND cliente_id=?`).get(hoje, clienteId);
  const aPagarPagoMes = db.prepare(`SELECT COALESCE(SUM(valor_pago),0) as total FROM contas_pagar WHERE status='pago' AND strftime('%m', data_pagamento)=? AND strftime('%Y', data_pagamento)=? AND cliente_id=?`).get(mesAtual, String(anoAtual), clienteId);

  const aReceberPendente = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber WHERE status='pendente' AND cliente_id=?`).get(clienteId);
  const aReceberAtrasado = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber WHERE (status='atrasado' OR (status='pendente' AND data_vencimento < ?)) AND cliente_id=?`).get(hoje, clienteId);
  const aReceberRecebidoMes = db.prepare(`SELECT COALESCE(SUM(valor_recebido),0) as total FROM contas_receber WHERE status='recebido' AND strftime('%m', data_recebimento)=? AND strftime('%Y', data_recebimento)=? AND cliente_id=?`).get(mesAtual, String(anoAtual), clienteId);

  const contasRecorrentes = db.prepare(`SELECT COUNT(*) as c FROM contas_pagar WHERE recorrente=1 AND status='pendente' AND cliente_id=?`).get(clienteId).c +
    db.prepare(`SELECT COUNT(*) as c FROM contas_receber WHERE recorrente=1 AND status='pendente' AND cliente_id=?`).get(clienteId).c;

  res.json({
    aPagarPendente: aPagarPendente.total,
    aPagarAtrasado: aPagarAtrasado.total,
    aPagarPagoMes: aPagarPagoMes.total,
    aReceberPendente: aReceberPendente.total,
    aReceberAtrasado: aReceberAtrasado.total,
    aReceberRecebidoMes: aReceberRecebidoMes.total,
    saldoDisponivel: aReceberRecebidoMes.total - aPagarPagoMes.total,
    contasRecorrentes
  });
});

router.get('/proximos-vencimentos', (req, res) => {
  const dias = Number(req.query.dias) || 30;
  const clienteId = req.user.clienteId;
  const hoje = new Date().toISOString().split('T')[0];
  const futuro = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT 'pagar' as tipo, id, descricao, valor, data_vencimento, status, 'Conta a Pagar' as origem FROM contas_pagar
    WHERE status='pendente' AND data_vencimento BETWEEN ? AND ? AND cliente_id=?
    UNION ALL
    SELECT 'receber' as tipo, id, descricao, valor, data_vencimento, status, 'Conta a Receber' as origem FROM contas_receber
    WHERE status='pendente' AND data_vencimento BETWEEN ? AND ? AND cliente_id=?
    ORDER BY data_vencimento ASC
  `).all(hoje, futuro, clienteId, hoje, futuro, clienteId);
  res.json(rows);
});

router.get('/detalhado', (req, res) => {
  const { data_inicio, data_fim, status, tipo } = req.query;
  const clienteId = req.user.clienteId;

  let conditionsPagar = ['cp.cliente_id = ?'];
  let conditionsReceber = ['cr.cliente_id = ?'];
  let paramsPagar = [clienteId];
  let paramsReceber = [clienteId];

  if (data_inicio && data_fim) {
    conditionsPagar.push('cp.data_vencimento BETWEEN ? AND ?');
    paramsPagar.push(data_inicio, data_fim);
    conditionsReceber.push('cr.data_vencimento BETWEEN ? AND ?');
    paramsReceber.push(data_inicio, data_fim);
  }

  if (status) {
    const statusList = status.split(',').filter(Boolean);
    if (statusList.length > 0) {
      const placeholders = statusList.map(() => '?').join(',');
      conditionsPagar.push(`cp.status IN (${placeholders})`);
      paramsPagar.push(...statusList);
      conditionsReceber.push(`cr.status IN (${placeholders})`);
      paramsReceber.push(...statusList);
    }
  }

  const wherePagar = 'WHERE ' + conditionsPagar.join(' AND ');
  const whereReceber = 'WHERE ' + conditionsReceber.join(' AND ');

  let results = [];

  if (!tipo || tipo === 'pagar') {
    const pagar = db.prepare(`
      SELECT 'pagar' as tipo, cp.id, cp.descricao, cp.valor, cp.valor_pago as valor_efetivo,
             cp.data_vencimento, cp.data_pagamento as data_efetivacao, cp.status,
             COALESCE(cp.categoria_nome,'Sem categoria') as categoria, cp.observacao
      FROM contas_pagar cp
      ${wherePagar}
      ORDER BY cp.data_vencimento ASC
    `).all(...paramsPagar);
    results = results.concat(pagar);
  }

  if (!tipo || tipo === 'receber') {
    const receber = db.prepare(`
      SELECT 'receber' as tipo, cr.id, cr.descricao, cr.valor, cr.valor_recebido as valor_efetivo,
             cr.data_vencimento, cr.data_recebimento as data_efetivacao, cr.status,
             COALESCE(cr.categoria_nome,'Sem categoria') as categoria, cr.observacao
      FROM contas_receber cr
      ${whereReceber}
      ORDER BY cr.data_vencimento ASC
    `).all(...paramsReceber);
    results = results.concat(receber);
  }

  results.sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''));

  const resumo = {
    totalPagar: results.filter(r => r.tipo === 'pagar').reduce((s, r) => s + r.valor, 0),
    totalReceber: results.filter(r => r.tipo === 'receber').reduce((s, r) => s + r.valor, 0),
    totalPago: results.filter(r => r.tipo === 'pagar' && r.status === 'pago').reduce((s, r) => s + (r.valor_efetivo || 0), 0),
    totalRecebido: results.filter(r => r.tipo === 'receber' && r.status === 'recebido').reduce((s, r) => s + (r.valor_efetivo || 0), 0),
    totalPendente: results.filter(r => r.status === 'pendente').reduce((s, r) => s + r.valor, 0),
    totalAtrasado: results.filter(r => r.status === 'atrasado').reduce((s, r) => s + r.valor, 0),
  };

  res.json({ dados: results, resumo });
});

router.get('/por-categoria', (req, res) => {
  const { data_inicio, data_fim } = req.query;
  const clienteId = req.user.clienteId;
  if (data_inicio && data_fim) {
    const pagar = db.prepare(`SELECT cp.categoria_nome as nome, COALESCE(SUM(cp.valor),0) as total
      FROM contas_pagar cp
      WHERE cp.status='pendente' AND cp.data_vencimento BETWEEN ? AND ? AND cp.cliente_id=? AND cp.categoria_nome IS NOT NULL GROUP BY cp.categoria_nome ORDER BY total DESC`).all(data_inicio, data_fim, clienteId);
    const receber = db.prepare(`SELECT cr.categoria_nome as nome, COALESCE(SUM(cr.valor),0) as total
      FROM contas_receber cr
      WHERE cr.status='pendente' AND cr.data_vencimento BETWEEN ? AND ? AND cr.cliente_id=? AND cr.categoria_nome IS NOT NULL GROUP BY cr.categoria_nome ORDER BY total DESC`).all(data_inicio, data_fim, clienteId);
    return res.json({ pagar, receber });
  }
  const pagar = db.prepare(`SELECT cp.categoria_nome as nome, COALESCE(SUM(cp.valor),0) as total
    FROM contas_pagar cp
    WHERE cp.status='pendente' AND cp.cliente_id=? AND cp.categoria_nome IS NOT NULL GROUP BY cp.categoria_nome ORDER BY total DESC`).all(clienteId);
  const receber = db.prepare(`SELECT cr.categoria_nome as nome, COALESCE(SUM(cr.valor),0) as total
    FROM contas_receber cr
    WHERE cr.status='pendente' AND cr.cliente_id=? AND cr.categoria_nome IS NOT NULL GROUP BY cr.categoria_nome ORDER BY total DESC`).all(clienteId);
  res.json({ pagar, receber });
});

module.exports = router;
