const nodemailer = require('nodemailer');
const { db } = require('./database');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
  });
  return transporter;
}

function formatCurrency(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

function emailTemplate(contas, tipo, dias) {
  const titulo = tipo === 'pagar' ? 'Contas a Pagar' : 'Contas a Receber';
  const labelVencimento = tipo === 'pagar' ? 'Vencimento' : 'Recebimento';
  const labelStatus = tipo === 'pagar' ? 'Pendente de Pagamento' : 'Pendente de Recebimento';

  let rows = contas.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">${c.descricao}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#e74c3c">${formatCurrency(c.valor)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">${formatDate(c.data_vencimento)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">
        <span style="background:#fff3cd;color:#856404;padding:3px 8px;border-radius:4px;font-size:12px">${labelStatus}</span>
      </td>
    </tr>
  `).join('');

  const totalContas = contas.length;
  const totalValor = contas.reduce((sum, c) => sum + c.valor, 0);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px">EasyMoney</h1>
      <p style="color:#aab;margin:4px 0 0;font-size:13px">Sistema de Controle Financeiro</p>
    </div>
    <div style="padding:24px 32px">
      <h2 style="color:#333;margin:0 0 8px;font-size:18px">⚠️ ${titulo} - Vencendo em ${dias} dia${dias > 1 ? 's' : ''}</h2>
      <p style="color:#666;margin:0 0 20px;font-size:14px">
        Você tem <strong>${totalContas} conta${totalContas > 1 ? 's' : ''}</strong> ${labelVencimento.toLowerCase()}${totalContas > 1 ? 's' : ''} 
        nos próximos <strong>${dias} dia${dias > 1 ? 's' : ''}</strong>, totalizando 
        <strong style="color:#e74c3c">${formatCurrency(totalValor)}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        <thead>
          <tr style="background:#f8f9fa">
            <th style="padding:10px 12px;text-align:left;color:#555">Descrição</th>
            <th style="padding:10px 12px;text-align:right;color:#555">Valor</th>
            <th style="padding:10px 12px;text-align:center;color:#555">${labelVencimento}</th>
            <th style="padding:10px 12px;text-align:center;color:#555">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#999;font-size:12px;text-align:center;margin:0">
        Acesse o sistema para mais detalhes e ações.
      </p>
    </div>
    <div style="background:#f8f9fa;padding:16px 32px;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">EasyMoney - Sistema de Controle Financeiro</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(to, subject, html) {
  const transport = getTransporter();
  if (!transport) {
    console.warn('[Email] SMTP não configurado, email não enviado para:', to);
    return false;
  }
  try {
    await transport.sendMail({
      from: config.smtp.from || config.smtp.user,
      to,
      subject,
      html
    });
    console.log(`[Email] Enviado para ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Email] Erro ao enviar para ${to}:`, err.message);
    return false;
  }
}

function jaNotificado(clienteId, tipoConta, contaId, usuarioId, dias) {
  const row = db.prepare(
    'SELECT id FROM notificacoes_enviadas WHERE cliente_id = ? AND tipo_conta = ? AND conta_id = ? AND usuario_id = ? AND dias_antes = ?'
  ).get(clienteId, tipoConta, contaId, usuarioId, dias);
  return !!row;
}

function registrarNotificacao(clienteId, tipoConta, contaId, usuarioId, dias) {
  db.prepare(
    'INSERT OR IGNORE INTO notificacoes_enviadas (cliente_id, tipo_conta, conta_id, usuario_id, dias_antes) VALUES (?, ?, ?, ?, ?)'
  ).run(clienteId, tipoConta, contaId, usuarioId, dias);
}

async function verificarEEnviarNotificacoes() {
  const smtp = getTransporter();
  if (!smtp) {
    console.log('[Notificação] SMTP não configurado, pulando verificação');
    return;
  }

  const DIAS = [1, 3, 7];
  const hoje = new Date().toISOString().split('T')[0];

  for (const dias of DIAS) {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() + dias);
    const dataStr = dataLimite.toISOString().split('T')[0];

    const contasPagar = db.prepare(`
      SELECT cp.*, c.nome as cliente_nome 
      FROM contas_pagar cp 
      JOIN clientes c ON cp.cliente_id = c.id 
      WHERE cp.status = 'pendente' 
      AND cp.data_vencimento = ?
      AND c.ativo = 1
    `).all(dataStr);

    const contasReceber = db.prepare(`
      SELECT cr.*, c.nome as cliente_nome 
      FROM contas_receber cr 
      JOIN clientes c ON cr.cliente_id = c.id 
      WHERE cr.status = 'pendente' 
      AND cr.data_vencimento = ?
      AND c.ativo = 1
    `).all(dataStr);

    const contasPorCliente = {};

    for (const conta of contasPagar) {
      if (!contasPorCliente[conta.cliente_id]) contasPorCliente[conta.cliente_id] = { pagar: [], receber: [] };
      contasPorCliente[conta.cliente_id].pagar.push(conta);
    }

    for (const conta of contasReceber) {
      if (!contasPorCliente[conta.cliente_id]) contasPorCliente[conta.cliente_id] = { pagar: [], receber: [] };
      contasPorCliente[conta.cliente_id].receber.push(conta);
    }

    for (const [clienteId, contas] of Object.entries(contasPorCliente)) {
      const usuarios = db.prepare(
        'SELECT * FROM usuarios WHERE cliente_id = ? AND ativo = 1'
      ).all(clienteId);

      if (usuarios.length === 0) continue;

      for (const usuario of usuarios) {
        const contasFiltradasPagar = contas.pagar.filter(c => !jaNotificado(clienteId, 'pagar', c.id, usuario.id, dias));
        if (contasFiltradasPagar.length > 0) {
          const html = emailTemplate(contasFiltradasPagar, 'pagar', dias);
          const assunto = `EasyMoney - ${contasFiltradasPagar.length} conta(s) a pagar vencendo em ${dias} dia(s)`;
          const enviado = await sendEmail(usuario.email, assunto, html);
          if (enviado) {
            for (const c of contasFiltradasPagar) {
              registrarNotificacao(clienteId, 'pagar', c.id, usuario.id, dias);
            }
          }
        }

        const contasFiltradasReceber = contas.receber.filter(c => !jaNotificado(clienteId, 'receber', c.id, usuario.id, dias));
        if (contasFiltradasReceber.length > 0) {
          const html = emailTemplate(contasFiltradasReceber, 'receber', dias);
          const assunto = `EasyMoney - ${contasFiltradasReceber.length} conta(s) a receber vencendo em ${dias} dia(s)`;
          const enviado = await sendEmail(usuario.email, assunto, html);
          if (enviado) {
            for (const c of contasFiltradasReceber) {
              registrarNotificacao(clienteId, 'receber', c.id, usuario.id, dias);
            }
          }
        }
      }
    }
  }

  db.persist();
  console.log('[Notificação] Verificação concluída em', new Date().toLocaleString('pt-BR'));
}

module.exports = { sendEmail, verificarEEnviarNotificacoes, getTransporter };
