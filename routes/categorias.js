const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', (req, res) => {
  const { tipo } = req.query;
  let rows;
  if (tipo) {
    rows = db.prepare('SELECT * FROM categorias WHERE tipo = ? OR tipo = ? ORDER BY nome').all(tipo, 'ambos');
  } else {
    rows = db.prepare('SELECT * FROM categorias ORDER BY nome').all();
  }
  res.json(rows);
});

router.post('/', (req, res) => {
  const { nome, tipo } = req.body;
  if (!nome || !tipo) return res.status(400).json({ error: 'nome e tipo são obrigatórios' });
  try {
    const result = db.prepare('INSERT INTO categorias (nome, tipo) VALUES (?, ?)').run(nome, tipo);
    res.status(201).json(db.prepare('SELECT * FROM categorias WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Categoria já existe ou inválida' });
  }
});

module.exports = router;
