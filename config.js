const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  const defaults = {
    port: 3001,
    session: { secret: 'easymoney-default-secret' },
    google: { clientID: '', clientSecret: '', callbackURL: '' },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '' }
  };

  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.warn('config.json mal formatado, usando padrões');
    }
  }

  const config = {
    port: parseInt(process.env.PORT, 10) || fileConfig.port || defaults.port,
    session: {
      secret: process.env.SESSION_SECRET || fileConfig.session?.secret || defaults.session.secret
    },
    google: {
      clientID: process.env.GOOGLE_CLIENT_ID || fileConfig.google?.clientID || defaults.google.clientID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || fileConfig.google?.clientSecret || defaults.google.clientSecret,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || fileConfig.google?.callbackURL || defaults.google.callbackURL
    },
    smtp: {
      host: process.env.SMTP_HOST || fileConfig.smtp?.host || defaults.smtp.host,
      port: parseInt(process.env.SMTP_PORT, 10) || fileConfig.smtp?.port || defaults.smtp.port,
      secure: process.env.SMTP_SECURE === 'true' || fileConfig.smtp?.secure || defaults.smtp.secure,
      user: process.env.SMTP_USER || fileConfig.smtp?.user || defaults.smtp.user,
      pass: process.env.SMTP_PASS || fileConfig.smtp?.pass || defaults.smtp.pass,
      from: process.env.SMTP_FROM || fileConfig.smtp?.from || defaults.smtp.from
    }
  };

  if (!config.google.clientID || !config.google.clientSecret) {
    console.warn('Google OAuth não configurado. Acesse https://console.cloud.google.com/ para criar suas credenciais.');
  }

  if (!config.smtp.host) {
    console.warn('SMTP não configurado. Notificações por email estarão desabilitadas.');
  }

  return config;
}

module.exports = loadConfig();
