const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', (req, res) => {
  const { tipo } = req.query;
  const clienteId = req.user.clienteId;
  const sort = "ORDER BY REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(nome,'Á','A'),'É','E'),'Í','I'),'Ó','O'),'Ú','U'),'Ç','C'),'Ã','A') COLLATE NOCASE";
  let rows;
  if (tipo) {
    rows = db.prepare('SELECT nome, tipo, cliente_id FROM categorias WHERE (tipo = ? OR tipo = ?) AND cliente_id = ? ' + sort).all(tipo, 'ambos', clienteId);
  } else {
    rows = db.prepare('SELECT nome, tipo, cliente_id FROM categorias WHERE cliente_id = ? ' + sort).all(clienteId);
  }
  res.json(rows);
});

router.post('/', (req, res) => {
  const { nome, tipo } = req.body;
  const clienteId = req.user.clienteId;
  if (!nome || !tipo) return res.status(400).json({ error: 'nome e tipo são obrigatórios' });
  try {
    db.prepare('INSERT INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)').run(nome, tipo, clienteId);
    db.persist();
    res.status(201).json({ nome, tipo, cliente_id: clienteId });
  } catch (e) {
    res.status(400).json({ error: 'Categoria já existe ou inválida' });
  }
});

router.put('/:nome', (req, res) => {
  const { nome: newNome, tipo } = req.body;
  const clienteId = req.user.clienteId;
  const catNome = decodeURIComponent(req.params.nome);
  const existing = db.prepare('SELECT * FROM categorias WHERE nome = ? AND cliente_id = ?').get(catNome, clienteId);
  if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });
  try {
    if (newNome && newNome !== catNome) {
      db.prepare('UPDATE contas_pagar SET categoria_nome = ? WHERE categoria_nome = ? AND cliente_id = ?').run(newNome, catNome, clienteId);
      db.prepare('UPDATE contas_receber SET categoria_nome = ? WHERE categoria_nome = ? AND cliente_id = ?').run(newNome, catNome, clienteId);
      db.prepare('DELETE FROM categorias WHERE nome = ? AND cliente_id = ?').run(catNome, clienteId);
      db.prepare('INSERT INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)').run(newNome, tipo ?? existing.tipo, clienteId);
    } else {
      db.prepare('UPDATE categorias SET tipo=? WHERE nome=? AND cliente_id=?').run(
        tipo ?? existing.tipo, catNome, clienteId
      );
    }
    db.persist();
    res.json({ nome: newNome || catNome, tipo: tipo ?? existing.tipo, cliente_id: clienteId });
  } catch (e) {
    res.status(400).json({ error: 'Nome já existe ou inválido' });
  }
});

router.delete('/:nome', (req, res) => {
  const clienteId = req.user.clienteId;
  const catNome = decodeURIComponent(req.params.nome);
  const existing = db.prepare('SELECT * FROM categorias WHERE nome = ? AND cliente_id = ?').get(catNome, clienteId);
  if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });
  db.prepare('UPDATE contas_pagar SET categoria_nome = NULL WHERE categoria_nome = ? AND cliente_id = ?').run(catNome, clienteId);
  db.prepare('UPDATE contas_receber SET categoria_nome = NULL WHERE categoria_nome = ? AND cliente_id = ?').run(catNome, clienteId);
  db.prepare('DELETE FROM categorias WHERE nome = ? AND cliente_id = ?').run(catNome, clienteId);
  db.persist();
  res.json({ message: 'Categoria removida' });
});

module.exports = router;
