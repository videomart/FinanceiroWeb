const express = require('express');
const path = require('path');
const session = require('express-session');
const { initDatabase } = require('./database');
const config = require('./config');
const { passport, ensureAuth, router: authRouter } = require('./auth');

const app = express();
const PORT = config.port;

app.use(express.json());
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/auth', authRouter);

app.use('/api', ensureAuth);

const contasPagarRoutes = require('./routes/contasPagar');
const contasReceberRoutes = require('./routes/contasReceber');
const dashboardRoutes = require('./routes/dashboard');
const categoriasRoutes = require('./routes/categorias');
const relatoriosRoutes = require('./routes/relatorios');
const adminRoutes = require('./routes/admin');

app.use('/api/contas-pagar', contasPagarRoutes);
app.use('/api/contas-receber', contasReceberRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/admin', adminRoutes);

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('*', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    if (!config.google.clientID || !config.google.clientSecret) {
      console.log('\nGoogle OAuth não configurado. Para ativar:');
      console.log('1. Acesse https://console.cloud.google.com/');
      console.log('2. Crie um projeto e ative a Google People API');
      console.log('3. Crie credenciais OAuth 2.0 (Web application)');
      console.log(`4. Adicione redirect URI: http://localhost:${PORT}/auth/google/callback`);
      console.log('5. Edite config.json com clientID e clientSecret\n');
    }

    const { verificarEEnviarNotificacoes } = require('./emailService');
    const UM_DIA = 24 * 60 * 60 * 1000;
    const HORARIO_VERIFICACAO = 8;
    function agendarProximaVerificacao() {
      const agora = new Date();
      const proximo = new Date(agora);
      proximo.setHours(HORARIO_VERIFICACAO, 0, 0, 0);
      if (proximo <= agora) proximo.setDate(proximo.getDate() + 1);
      const delay = proximo - agora;
      console.log(`[Notificação] Próxima verificação: ${proximo.toLocaleString('pt-BR')}`);
      setTimeout(async () => {
        await verificarEEnviarNotificacoes();
        agendarProximaVerificacao();
      }, delay);
    }
    if (config.smtp.host) {
      console.log('[Notificação] Verificação diária de contas a vencer agendada às 08:00');
      agendarProximaVerificacao();
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nErro: a porta ${PORT} já está em uso.`);
      console.error('Para usar outra porta, defina a variável de ambiente PORT antes de iniciar. Exemplos:');
      console.error(`  PORT=3005 npm start`);
      console.error(`  PORT=3005 docker compose up -d`);
      console.error('Você também pode definir "port" em config.json.\n');
      process.exit(1);
    }
    throw err;
  });
}).catch(err => {
  console.error('Erro ao inicializar banco de dados:', err);
  process.exit(1);
});
