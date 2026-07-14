const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { db } = require('./database');
const config = require('./config');

passport.serializeUser((user, done) => {
  done(null, { id: user.id, clienteId: user.cliente_id, nome: user.nome, email: user.email, avatar: user.avatar, papel: user.papel });
});

passport.deserializeUser((obj, done) => {
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(obj.id);
  if (user) {
    done(null, { id: user.id, clienteId: user.cliente_id, nome: user.nome, email: user.email, avatar: user.avatar, papel: user.papel });
  } else {
    done(null, false);
  }
});

if (config.google.clientID && config.google.clientSecret) {
  passport.use(new GoogleStrategy({
    clientID: config.google.clientID,
    clientSecret: config.google.clientSecret,
    callbackURL: config.google.callbackURL
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || '';
      const dominio = email.split('@')[1] || '';
      const nome = profile.displayName || email;
      const avatar = profile.photos?.[0]?.value || '';
      const googleId = profile.id;

      let user = db.prepare('SELECT * FROM usuarios WHERE google_id = ?').get(googleId);

      if (!user) {
        user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
        if (user) {
          db.prepare('UPDATE usuarios SET google_id = ? WHERE id = ?').run(googleId, user.id);
        }
      }

      if (!user) {
        return done(null, false, { message: 'Usuário não cadastrado. Solicite acesso ao administrador.' });
      }

      if (user.ativo === 0) {
        return done(null, false, { message: 'Usuário desativado. Solicite acesso ao administrador.' });
      }

      const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(user.cliente_id);
      if (cliente && cliente.ativo === 0) {
        return done(null, false, { message: 'Empresa desativada. Solicite acesso ao administrador.' });
      }

      db.prepare('UPDATE usuarios SET ultimo_acesso = datetime("now","localtime"), nome = ?, avatar = ? WHERE id = ?').run(nome, avatar, user.id);

      return done(null, { id: user.id, cliente_id: user.cliente_id, nome: user.nome, email: user.email, avatar: user.avatar, papel: user.papel });
    } catch (err) {
      return done(err, null);
    }
  }));
} else {
  console.warn('Google OAuth não configurado. O login via Google não estará disponível.');
}

function seedCategoriasForClient(clienteId) {
  const { CATEGORIAS_BASE } = require('./database');
  const insert = db.prepare('INSERT OR IGNORE INTO categorias (nome, tipo, cliente_id) VALUES (?, ?, ?)');
  for (const [nome, tipo] of CATEGORIAS_BASE) {
    try { insert.run(nome, tipo, clienteId); } catch (e) { }
  }
  db.persist();
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('json') || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  res.redirect('/login.html');
}

const router = require('express').Router();
const googleConfigured = !!(config.google.clientID && config.google.clientSecret);

if (googleConfigured) {
  router.get('/google',
    passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
  );

  router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        const msg = encodeURIComponent(info?.message || 'Acesso não autorizado');
        return res.redirect(`/login.html?error=${msg}`);
      }
      req.login(user, (err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    })(req, res, next);
  });
} else {
  router.get('/google', (req, res) => {
    res.status(503).send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div style="text-align:center">
        <h2>Google OAuth não configurado</h2>
        <p>Edite o arquivo <code>config.json</code> com as credenciais do Google.</p>
        <p style="font-size:.85rem;color:#666">
          Acesse <a href="https://console.cloud.google.com/">console.cloud.google.com</a>,
          crie um projeto e gere um Client ID / Client Secret para OAuth 2.0.
        </p>
      </div></body></html>
    `);
  });

  router.get('/google/callback', (req, res) => {
    res.redirect('/login.html?error=true');
  });
}

router.post('/dev-login', (req, res) => {
  let user = db.prepare("SELECT * FROM usuarios WHERE email = 'dev@localhost'").get();
  if (!user) {
    let cliente = db.prepare("SELECT id FROM clientes WHERE id = 1").get();
    if (!cliente) {
      const r = db.prepare("INSERT INTO clientes (nome, dominio) VALUES ('Desenvolvimento', 'localhost')").run();
      cliente = { id: r.lastInsertRowid };
      seedCategoriasForClient(cliente.id);
    }
    const r = db.prepare("INSERT INTO usuarios (cliente_id, google_id, email, nome, avatar, papel) VALUES (?, 'dev', 'dev@localhost', 'Usuário Dev', '', 'admin')").run(cliente.id);
    user = { id: r.lastInsertRowid, cliente_id: cliente.id, email: 'dev@localhost', nome: 'Usuário Dev', avatar: '', papel: 'admin' };
  }
  req.login({ id: user.id, clienteId: user.cliente_id, nome: user.nome, email: user.email, avatar: user.avatar, papel: user.papel }, (err) => {
    if (err) return res.status(500).json({ error: 'Erro no login' });
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json({
      id: req.user.id,
      nome: req.user.nome,
      email: req.user.email,
      avatar: req.user.avatar,
      papel: req.user.papel,
      clienteId: req.user.clienteId
    });
  } else {
    res.status(401).json({ error: 'Não autenticado' });
  }
});

router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/login.html');
  });
});

module.exports = { passport, ensureAuth, router };
