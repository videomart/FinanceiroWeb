const PageAdmin = {
  currentTab: 'clientes',

  async render(container) {
    container.innerHTML = `
      <div class="card fade-in">
        <div class="card-header">
          <h3>Configurações</h3>
        </div>
        <div class="admin-tabs">
          <button class="btn ${this.currentTab === 'clientes' ? 'btn-primary' : 'btn-outline'}" onclick="PageAdmin.switchTab('clientes')">Clientes</button>
          <button class="btn ${this.currentTab === 'usuarios' ? 'btn-primary' : 'btn-outline'}" onclick="PageAdmin.switchTab('usuarios')">Usuários</button>
          <button class="btn ${this.currentTab === 'categorias' ? 'btn-primary' : 'btn-outline'}" onclick="PageAdmin.switchTab('categorias')">Categorias</button>
          <button class="btn ${this.currentTab === 'notificacoes' ? 'btn-primary' : 'btn-outline'}" onclick="PageAdmin.switchTab('notificacoes')">Notificações</button>
        </div>
        <div id="adminContent"></div>
      </div>
    `;
    this.loadTabContent();
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.admin-tabs .btn').forEach(b => b.className = 'btn btn-outline');
    const tabNames = { clientes: 'Clientes', usuarios: 'Usuários', categorias: 'Categorias', notificacoes: 'Notificações' };
    document.querySelectorAll('.admin-tabs .btn').forEach(b => {
      if (b.textContent === tabNames[tab]) b.className = 'btn btn-primary';
    });
    this.loadTabContent();
  },

  async loadTabContent() {
    const el = document.getElementById('adminContent');
    if (this.currentTab === 'clientes') {
      await this.renderClientes(el);
    } else if (this.currentTab === 'categorias') {
      await this.renderCategorias(el);
    } else if (this.currentTab === 'notificacoes') {
      await this.renderNotificacoes(el);
    } else {
      await this.renderUsuarios(el);
    }
  },

  async renderClientes(el) {
    el.innerHTML = '<p>Carregando...</p>';
    try {
      const clientes = await API.get('/api/admin/clientes');
      el.innerHTML = `
        <div style="margin-bottom:16px">
          <button class="btn btn-primary" onclick="PageAdmin.openClienteModal()">+ Novo Cliente</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr>
              <th>ID</th><th>Nome</th><th>Domínio</th><th>Usuários</th><th>Ativo</th><th>Ações</th>
            </tr></thead>
            <tbody>
              ${clientes.map(c => `
                <tr>
                  <td>${c.id}</td>
                  <td><strong>${c.nome}</strong></td>
                  <td>${c.dominio || '-'}</td>
                  <td>${c.total_usuarios}</td>
                  <td>${c.ativo ? '<span class="badge badge-pago">Sim</span>' : '<span class="badge badge-cancelado">Não</span>'}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline" onclick="PageAdmin.openClienteModal(${c.id})">Editar</button>
                      <button class="btn btn-sm btn-outline" onclick="PageAdmin.verUsuarios(${c.id}, '${c.nome}')">Usuários</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      el.innerHTML = `<p style="color:var(--danger)">Erro ao carregar clientes: ${e.message}</p>`;
    }
  },

  async renderUsuarios(el) {
    el.innerHTML = '<p>Carregando...</p>';
    try {
      const usuarios = await API.get('/api/admin/usuarios');
      el.innerHTML = `
        <div style="margin-bottom:16px">
          <button class="btn btn-primary" onclick="PageAdmin.openUsuarioModal()">+ Vincular Usuário</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr>
              <th>ID</th><th>Nome</th><th>Email</th><th>Cliente</th><th>Papel</th><th>Ativo</th><th>Ações</th>
            </tr></thead>
            <tbody>
              ${usuarios.map(u => `
                <tr>
                  <td>${u.id}</td>
                  <td><strong>${u.nome}</strong></td>
                  <td>${u.email}</td>
                  <td>${u.cliente_nome || '-'}</td>
                  <td><span class="badge badge-${u.papel === 'admin' ? 'info' : 'pendente'}">${u.papel}</span></td>
                  <td>${u.ativo ? '<span class="badge badge-pago">Sim</span>' : '<span class="badge badge-cancelado">Não</span>'}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline" onclick="PageAdmin.openUsuarioModal(${u.id})">Editar</button>
                      <button class="btn btn-sm btn-danger" onclick="PageAdmin.removerUsuario(${u.id})">Remover</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      el.innerHTML = `<p style="color:var(--danger)">Erro ao carregar usuários: ${e.message}</p>`;
    }
  },

  async openClienteModal(id) {
    let cliente = null;
    if (id) {
      const clientes = await API.get('/api/admin/clientes');
      cliente = clientes.find(c => c.id === id);
    }
    App.openModal(
      cliente ? 'Editar Cliente' : 'Novo Cliente',
      `
        <div class="form-group">
          <label>Nome</label>
          <input class="form-control" id="inputClienteNome" value="${cliente ? cliente.nome : ''}" placeholder="Nome do cliente">
        </div>
        <div class="form-group">
          <label>Domínio (para associar automaticamente usuários com esse email)</label>
          <input class="form-control" id="inputClienteDominio" value="${cliente ? (cliente.dominio || '') : ''}" placeholder="ex: meudominio.com">
        </div>
      `,
      `
        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="PageAdmin.salvarCliente(${id || ''})">Salvar</button>
      `
    );
  },

  async salvarCliente(id) {
    const nome = document.getElementById('inputClienteNome').value.trim();
    const dominio = document.getElementById('inputClienteDominio').value.trim();
    if (!nome) return alert('Nome é obrigatório');
    try {
      if (id) {
        await API.put(`/api/admin/clientes/${id}`, { nome, dominio: dominio || null });
      } else {
        await API.post('/api/admin/clientes', { nome, dominio: dominio || null });
      }
      App.closeModal();
      this.loadTabContent();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async verUsuarios(id, nome) {
    try {
      const usuarios = await API.get(`/api/admin/clientes/${id}/usuarios`);
      App.openModal(
        `Usuários de ${nome}`,
        `
          <div style="margin-bottom:12px">
            <button class="btn btn-sm btn-primary" onclick="PageAdmin.openUsuarioModal(null, ${id})">+ Vincular</button>
          </div>
          <div class="table-container">
            <table>
              <thead><tr><th>Nome</th><th>Email</th><th>Papel</th><th>Ações</th></tr></thead>
              <tbody>
                ${usuarios.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary)">Nenhum usuário</td></tr>' :
                  usuarios.map(u => `
                    <tr>
                      <td><strong>${u.nome}</strong></td>
                      <td>${u.email}</td>
                      <td><span class="badge badge-${u.papel === 'admin' ? 'info' : 'pendente'}">${u.papel}</span></td>
                      <td><button class="btn btn-sm btn-danger" onclick="PageAdmin.desvincularUsuario(${u.id}, ${id})">Remover</button></td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>
        `,
        `<button class="btn btn-outline" onclick="App.closeModal()">Fechar</button>`
      );
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async openUsuarioModal(id, clienteIdFixo) {
    let user = null;
    if (id) {
      const users = await API.get('/api/admin/usuarios');
      user = users.find(u => u.id === id);
    }
    const clientes = await API.get('/api/admin/clientes');
    App.openModal(
      user ? 'Editar Usuário' : 'Vincular Usuário',
      `
        <div class="form-group">
          <label>Email</label>
          <input class="form-control" id="inputUserEmail" value="${user ? user.email : ''}" placeholder="email@exemplo.com" ${user ? 'readonly' : ''}>
        </div>
        <div class="form-group">
          <label>Nome</label>
          <input class="form-control" id="inputUserNome" value="${user ? user.nome : ''}" placeholder="Nome do usuário">
        </div>
        <div class="form-group">
          <label>Cliente</label>
          <select class="form-control" id="inputUserCliente">
            ${clientes.map(c => `<option value="${c.id}" ${(user && user.cliente_id === c.id) || clienteIdFixo === c.id ? 'selected' : ''}>${c.nome}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Papel</label>
          <select class="form-control" id="inputUserPapel">
            <option value="usuario" ${user && user.papel === 'usuario' ? 'selected' : ''}>Usuário</option>
            <option value="admin" ${user && user.papel === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </div>
      `,
      `
        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="PageAdmin.salvarUsuario(${id || ''})">Salvar</button>
      `
    );
  },

  async salvarUsuario(id) {
    const email = document.getElementById('inputUserEmail').value.trim();
    const nome = document.getElementById('inputUserNome').value.trim();
    const cliente_id = parseInt(document.getElementById('inputUserCliente').value);
    const papel = document.getElementById('inputUserPapel').value;
    if (!email) return alert('Email é obrigatório');
    try {
      if (id) {
        await API.put(`/api/admin/usuarios/${id}`, { nome: nome || undefined, papel, cliente_id });
      } else {
        await API.post('/api/admin/usuarios', { email, nome: nome || email.split('@')[0], cliente_id, papel });
      }
      App.closeModal();
      this.loadTabContent();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async removerUsuario(id) {
    if (!confirm('Remover este usuário?')) return;
    try {
      await API.del(`/api/admin/usuarios/${id}`);
      this.loadTabContent();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async desvincularUsuario(userId, clienteId) {
    if (!confirm('Remover este usuário do cliente?')) return;
    try {
      await API.del(`/api/admin/usuarios/${userId}`);
      App.closeModal();
      this.verUsuarios(clienteId, '');
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async renderCategorias(el) {
    el.innerHTML = '<p>Carregando...</p>';
    try {
      const cats = await API.get('/api/categorias');
      el.innerHTML = `
        <div style="margin-bottom:16px">
          <button class="btn btn-primary" onclick="PageAdmin.openCategoriaModal()">+ Nova Categoria</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Ações</th></tr></thead>
            <tbody>
              ${cats.map(c => `
                <tr>
                  <td><strong>${c.nome}</strong></td>
                  <td><span class="badge badge-${c.tipo === 'receita' ? 'success' : c.tipo === 'despesa' ? 'danger' : 'info'}">${c.tipo}</span></td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-outline" onclick="PageAdmin.openCategoriaModal('${encodeURIComponent(c.nome)}')">Editar</button>
                      <button class="btn btn-sm btn-danger" onclick="PageAdmin.excluirCategoria('${encodeURIComponent(c.nome)}')">Excluir</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      el.innerHTML = `<p style="color:var(--danger)">Erro ao carregar categorias: ${e.message}</p>`;
    }
  },

  async openCategoriaModal(encodedNome) {
    let cat = { nome: '', tipo: 'despesa' };
    if (encodedNome) {
      const cats = await API.get('/api/categorias');
      cat = cats.find(x => encodeURIComponent(x.nome) === encodedNome) || cat;
    }
    App.openModal(
      encodedNome ? 'Editar Categoria' : 'Nova Categoria',
      `
        <div class="form-group">
          <label>Nome</label>
          <input class="form-control" id="inputCatNome" value="${cat.nome || ''}" placeholder="Nome da categoria">
        </div>
        <div class="form-group">
          <label>Tipo</label>
          <select class="form-control" id="inputCatTipo">
            <option value="despesa" ${(!encodedNome || cat.tipo === 'despesa') ? 'selected' : ''}>Despesa</option>
            <option value="receita" ${cat.tipo === 'receita' ? 'selected' : ''}>Receita</option>
            <option value="ambos" ${cat.tipo === 'ambos' ? 'selected' : ''}>Ambos</option>
          </select>
        </div>
      `,
      `
        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="PageAdmin.salvarCategoria('${encodedNome || ''}')">Salvar</button>
      `
    );
  },

  async salvarCategoria(encodedNome) {
    const nome = document.getElementById('inputCatNome').value.trim();
    const tipo = document.getElementById('inputCatTipo').value;
    if (!nome) return alert('Nome é obrigatório');
    try {
      if (encodedNome) {
        await API.put(`/api/categorias/${encodedNome}`, { nome, tipo });
      } else {
        await API.post('/api/categorias', { nome, tipo });
      }
      App.closeModal();
      this.renderCategorias(document.getElementById('adminContent'));
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async excluirCategoria(encodedNome) {
    if (!confirm('Excluir esta categoria?')) return;
    try {
      await API.del(`/api/categorias/${encodedNome}`);
      this.renderCategorias(document.getElementById('adminContent'));
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async renderNotificacoes(el) {
    el.innerHTML = '<p>Carregando...</p>';
    try {
      const [status, notificacoes] = await Promise.all([
        API.get('/api/admin/email/status'),
        API.get('/api/admin/email/notificacoes')
      ]);
      el.innerHTML = `
        <div style="margin-bottom:20px">
          <h4 style="margin:0 0 8px">Configuração SMTP</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div>
              <label style="font-size:.85rem;color:var(--text-secondary)">Servidor SMTP</label>
              <input class="form-control" id="smtpHost" value="${status.host || ''}" placeholder="smtp.gmail.com">
            </div>
            <div>
              <label style="font-size:.85rem;color:var(--text-secondary)">Porta</label>
              <input class="form-control" id="smtpPort" type="number" value="${status.port || 587}">
            </div>
            <div>
              <label style="font-size:.85rem;color:var(--text-secondary)">Usuário</label>
              <input class="form-control" id="smtpUser" value="${status.user || ''}" placeholder="seu@email.com">
            </div>
            <div>
              <label style="font-size:.85rem;color:var(--text-secondary)">Senha</label>
              <input class="form-control" id="smtpPass" type="password" value="" placeholder="••••••••">
            </div>
            <div>
              <label style="font-size:.85rem;color:var(--text-secondary)">Email Remetente</label>
              <input class="form-control" id="smtpFrom" value="${status.from || ''}" placeholder="EasyMoney <noreply@seudominio.com.br>">
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <button class="btn btn-primary" onclick="PageAdmin.salvarSmtp()">Salvar Configuração</button>
            <button class="btn btn-outline" onclick="PageAdmin.testarEmail()">Enviar Email de Teste</button>
            <button class="btn btn-outline" onclick="PageAdmin.verificarAgora()">Verificar Contas Agora</button>
          </div>
        </div>
        <div>
          <h4 style="margin:0 0 12px">Notificações Enviadas</h4>
          ${notificacoes.length === 0 ? '<p style="color:var(--text-secondary)">Nenhuma notificação enviada ainda.</p>' : `
          <div class="table-container">
            <table>
              <thead><tr><th>Data</th><th>Usuário</th><th>Cliente</th><th>Tipo</th><th>Dias</th></tr></thead>
              <tbody>
                ${notificacoes.map(n => `
                  <tr>
                    <td>${new Date(n.enviado_em).toLocaleString('pt-BR')}</td>
                    <td>${n.usuario_nome} (${n.usuario_email})</td>
                    <td>${n.cliente_nome}</td>
                    <td><span class="badge badge-${n.tipo_conta === 'pagar' ? 'danger' : 'success'}">${n.tipo_conta === 'pagar' ? 'A Pagar' : 'A Receber'}</span></td>
                    <td>${n.dias_antes} dia(s)</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      `;
    } catch (e) {
      el.innerHTML = `<p style="color:var(--danger)">Erro ao carregar notificações: ${e.message}</p>`;
    }
  },

  async salvarSmtp() {
    const smtpConfig = {
      host: document.getElementById('smtpHost').value.trim(),
      port: parseInt(document.getElementById('smtpPort').value) || 587,
      user: document.getElementById('smtpUser').value.trim(),
      pass: document.getElementById('smtpPass').value,
      from: document.getElementById('smtpFrom').value.trim()
    };
    try {
      const res = await API.post('/api/admin/email/config', smtpConfig);
      alert(res.message || 'Configuração salva! Reinicie o servidor para aplicar.');
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async testarEmail() {
    const email = prompt('Digite o email para enviar o teste:');
    if (!email) return;
    try {
      const res = await API.post('/api/admin/email/teste', { email });
      alert(res.message || 'Email enviado com sucesso!');
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async verificarAgora() {
    try {
      const res = await API.post('/api/admin/email/verificar');
      alert(res.message || 'Verificação concluída!');
      this.renderNotificacoes(document.getElementById('adminContent'));
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }
};
