const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { sendEmail, verificarEEnviarNotificacoes, getTransporter } = require('../emailService');
const config = require('../config');

function ensureAdmin(req, res, next) {
  if (req.user && req.user.papel === 'admin') return next();
  res.status(403).json({ error: 'Acesso restrito a administradores' });
}

router.use(ensureAdmin);

router.get('/clientes', (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM usuarios WHERE cliente_id = c.id) as total_usuarios FROM clientes c ORDER BY c.nome`).all();
  res.json(rows);
});

router.post('/clientes', (req, res) => {
  const { nome, dominio } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const r = db.prepare('INSERT INTO clientes (nome, dominio) VALUES (?, ?)').run(nome, dominio || null);
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(r.lastInsertRowid);
    const { CATEGORIAS_BASE } = require('../database');
    const insert = db.prepare('INSERT OR IGNORE INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)');
    for (const [nome, tipo] of CATEGORIAS_BASE) {
      try { insert.run(nome, tipo, cliente.id); } catch (e) { }
    }
    db.persist();
    res.status(201).json(cliente);
  } catch (e) {
    res.status(400).json({ error: 'Erro ao criar cliente' });
  }
});

router.put('/clientes/:id', (req, res) => {
  const { nome, dominio, ativo } = req.body;
  const existing = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });
  db.prepare('UPDATE clientes SET nome=?, dominio=?, ativo=? WHERE id=?').run(
    nome ?? existing.nome, dominio ?? existing.dominio,
    ativo !== undefined ? (ativo ? 1 : 0) : existing.ativo,
    req.params.id
  );
  db.persist();
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

router.get('/clientes/:id/usuarios', (req, res) => {
  const clientes = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!clientes) return res.status(404).json({ error: 'Cliente não encontrado' });
  const rows = db.prepare('SELECT id, google_id, email, nome, avatar, papel, ativo, ultimo_acesso, created_at FROM usuarios WHERE cliente_id = ? ORDER BY nome').all(req.params.id);
  res.json(rows);
});

router.get('/usuarios', (req, res) => {
  const { cliente_id } = req.query;
  let rows;
  if (cliente_id) {
    rows = db.prepare('SELECT u.*, c.nome as cliente_nome FROM usuarios u LEFT JOIN clientes c ON u.cliente_id = c.id WHERE u.cliente_id = ? ORDER BY u.nome').all(cliente_id);
  } else {
    rows = db.prepare('SELECT u.*, c.nome as cliente_nome FROM usuarios u LEFT JOIN clientes c ON u.cliente_id = c.id ORDER BY u.nome').all();
  }
  res.json(rows);
});

router.post('/usuarios', (req, res) => {
  const { email, nome, cliente_id, papel } = req.body;
  if (!email || !cliente_id) return res.status(400).json({ error: 'email e cliente_id são obrigatórios' });
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id);
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
  const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (existente) {
    db.prepare('UPDATE usuarios SET cliente_id=?, papel=? WHERE id=?').run(cliente_id, papel || 'usuario', existente.id);
    db.persist();
    return res.json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(existente.id));
  }
  try {
    const r = db.prepare('INSERT INTO usuarios (cliente_id, email, nome, papel) VALUES (?, ?, ?, ?)').run(
      cliente_id, email, nome || email.split('@')[0], papel || 'usuario'
    );
    db.persist();
    res.status(201).json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Erro ao criar usuário' });
  }
});

router.put('/usuarios/:id', (req, res) => {
  const { nome, papel, ativo, cliente_id } = req.body;
  const existing = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });
  db.prepare('UPDATE usuarios SET nome=?, papel=?, ativo=?, cliente_id=? WHERE id=?').run(
    nome ?? existing.nome, papel ?? existing.papel,
    ativo !== undefined ? (ativo ? 1 : 0) : existing.ativo,
    cliente_id ?? existing.cliente_id,
    req.params.id
  );
  db.persist();
  res.json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id));
});

router.delete('/usuarios/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  db.persist();
  res.json({ message: 'Usuário removido' });
});

router.get('/email/status', (req, res) => {
  const smtp = getTransporter();
  res.json({
    configurado: !!config.smtp.host,
    host: config.smtp.host || null,
    port: config.smtp.port || null,
    user: config.smtp.user || null,
    from: config.smtp.from || null,
    conectado: !!smtp
  });
});

router.post('/email/config', (req, res) => {
  const { host, port, user, pass, from } = req.body;
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    fileConfig.smtp = {
      host: host || '',
      port: port || 587,
      secure: port === 465,
      user: user || '',
      pass: pass || fileConfig.smtp?.pass || '',
      from: from || ''
    };
    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));
    res.json({ success: true, message: 'Configuração SMTP salva. Reinicie o servidor para aplicar.' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar configuração: ' + e.message });
  }
});

router.post('/email/teste', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email é obrigatório' });
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 24px">
          <h1 style="color:#fff;margin:0;font-size:18px">EasyMoney</h1>
        </div>
        <div style="padding:24px">
          <h2 style="color:#27ae60;margin:0 0 12px">✅ Email de teste enviado!</h2>
          <p style="color:#555;font-size:14px">Se você recebeu este email, a configuração SMTP está funcionando corretamente.</p>
          <p style="color:#999;font-size:12px;margin-top:20px">Enviado em: ${new Date().toLocaleString('pt-BR')}</p>
        </div>
      </div>`;
    const enviado = await sendEmail(email, 'EasyMoney - Teste de Configuração de Email', html);
    if (enviado) {
      res.json({ success: true, message: 'Email de teste enviado com sucesso' });
    } else {
      res.status(500).json({ error: 'Falha ao enviar email. Verifique a configuração SMTP.' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erro ao enviar email: ' + e.message });
  }
});

router.post('/email/verificar', async (req, res) => {
  try {
    await verificarEEnviarNotificacoes();
    res.json({ success: true, message: 'Verificação concluída' });
  } catch (e) {
    res.status(500).json({ error: 'Erro na verificação: ' + e.message });
  }
});

router.get('/email/notificacoes', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.email as usuario_email, u.nome as usuario_nome, c.nome as cliente_nome
    FROM notificacoes_enviadas n
    JOIN usuarios u ON n.usuario_id = u.id
    JOIN clientes c ON n.cliente_id = c.id
    ORDER BY n.enviado_em DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

module.exports = router;
