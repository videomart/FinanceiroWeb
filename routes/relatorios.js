const express = require('express');
const router = express.Router();
const { db } = require('../database');

const FREQ_LABELS = { diaria: 'Diária', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };

router.get('/previsao', (req, res) => {
  const { meses = 6 } = req.query;
  const hoje = new Date();
  const previsoes = [];

  for (let i = 0; i < Number(meses); i++) {
    const mes = hoje.getMonth() + i;
    const ano = hoje.getFullYear() + Math.floor(mes / 12);
    const mesNum = (mes % 12) + 1;
    const mesStr = String(mesNum).padStart(2, '0');

    const aPagar = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar
      WHERE status='pendente' AND strftime('%Y-%m', data_vencimento)=?`).get(`${ano}-${mesStr}`);
    const aReceber = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber
      WHERE status='pendente' AND strftime('%Y-%m', data_vencimento)=?`).get(`${ano}-${mesStr}`);

    const saldo = aReceber.total - aPagar.total;
    previsoes.push({ mes: mesNum, ano, aPagar: aPagar.total, aReceber: aReceber.total, saldo });
  }

  res.json(previsoes);
});

router.get('/resumo-geral', (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
  const anoAtual = new Date().getFullYear();

  const aPagarPendente = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE status='pendente'`).get();
  const aPagarAtrasado = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_pagar WHERE (status='atrasado' OR (status='pendente' AND data_vencimento < ?))`).get(hoje);
  const aPagarPagoMes = db.prepare(`SELECT COALESCE(SUM(valor_pago),0) as total FROM contas_pagar WHERE status='pago' AND strftime('%m', data_pagamento)=? AND strftime('%Y', data_pagamento)=?`).get(mesAtual, String(anoAtual));

  const aReceberPendente = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber WHERE status='pendente'`).get();
  const aReceberAtrasado = db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM contas_receber WHERE (status='atrasado' OR (status='pendente' AND data_vencimento < ?))`).get(hoje);
  const aReceberRecebidoMes = db.prepare(`SELECT COALESCE(SUM(valor_recebido),0) as total FROM contas_receber WHERE status='recebido' AND strftime('%m', data_recebimento)=? AND strftime('%Y', data_recebimento)=?`).get(mesAtual, String(anoAtual));

  const contasRecorrentes = db.prepare(`SELECT COUNT(*) as c FROM contas_pagar WHERE recorrente=1 AND status='pendente'`).get().c +
    db.prepare(`SELECT COUNT(*) as c FROM contas_receber WHERE recorrente=1 AND status='pendente'`).get().c;

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
  const hoje = new Date().toISOString().split('T')[0];
  const futuro = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
  const rows = db.prepare(`
    SELECT 'pagar' as tipo, id, descricao, valor, data_vencimento, status, 'Conta a Pagar' as origem FROM contas_pagar
    WHERE status='pendente' AND data_vencimento BETWEEN ? AND ?
    UNION ALL
    SELECT 'receber' as tipo, id, descricao, valor, data_vencimento, status, 'Conta a Receber' as origem FROM contas_receber
    WHERE status='pendente' AND data_vencimento BETWEEN ? AND ?
    ORDER BY data_vencimento ASC
  `).all(hoje, futuro, hoje, futuro);
  res.json(rows);
});

router.get('/por-categoria', (req, res) => {
  const { data_inicio, data_fim } = req.query;
  if (data_inicio && data_fim) {
    const pagar = db.prepare(`SELECT c.nome, c.id as categoria_id, COALESCE(SUM(cp.valor),0) as total
      FROM contas_pagar cp LEFT JOIN categorias c ON cp.categoria_id = c.id
      WHERE cp.status='pendente' AND cp.data_vencimento BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`).all(data_inicio, data_fim);
    const receber = db.prepare(`SELECT c.nome, c.id as categoria_id, COALESCE(SUM(cr.valor),0) as total
      FROM contas_receber cr LEFT JOIN categorias c ON cr.categoria_id = c.id
      WHERE cr.status='pendente' AND cr.data_vencimento BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`).all(data_inicio, data_fim);
    return res.json({ pagar, receber });
  }
  const pagar = db.prepare(`SELECT c.nome, c.id as categoria_id, COALESCE(SUM(cp.valor),0) as total
    FROM contas_pagar cp LEFT JOIN categorias c ON cp.categoria_id = c.id
    WHERE cp.status='pendente' GROUP BY c.id ORDER BY total DESC`).all();
  const receber = db.prepare(`SELECT c.nome, c.id as categoria_id, COALESCE(SUM(cr.valor),0) as total
    FROM contas_receber cr LEFT JOIN categorias c ON cr.categoria_id = c.id
    WHERE cr.status='pendente' GROUP BY c.id ORDER BY total DESC`).all();
  res.json({ pagar, receber });
});

module.exports = router;
