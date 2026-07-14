const API = {
  async request(url, options = {}) {
    const res = await fetch(url, { ...options, credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Não autenticado');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `${options.method || 'GET'} ${url} failed`);
    }
    return res.json();
  },
  async get(url) {
    return this.request(url);
  },
  async post(url, data) {
    return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  },
  async put(url, data) {
    return this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  },
  async del(url) {
    return this.request(url, { method: 'DELETE' });
  }
};

const App = {
  currentPage: 'dashboard',
  charts: {},
  user: null,

  async init() {
    try {
      this.user = await API.get('/auth/me');
      this.renderUserInfo();
    } catch (e) {
      return;
    }
    this.updateDate();
    this.setupNavigation();
    this.setupModal();
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  renderUserInfo() {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const email = document.getElementById('userEmail');
    if (this.user) {
      if (this.user.avatar) {
        avatar.innerHTML = `<img src="${this.user.avatar}" alt="${this.user.nome}">`;
      } else {
        avatar.textContent = this.user.nome.charAt(0).toUpperCase();
      }
      name.textContent = this.user.nome;
      email.textContent = this.user.email;
    }
  },

  updateDate() {
    const d = new Date();
    document.getElementById('currentDate').textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  },

  setupNavigation() {
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        if (!el.classList.contains('logout-btn')) {
          document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
          el.classList.add('active');
        }
      });
    });
  },

  setupModal() {
    document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });
  },

  openModal(title, bodyHtml, footerHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFooter').innerHTML = footerHtml || '';
    document.getElementById('modalOverlay').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
  },

  showLoading(containerId) {
    document.getElementById(containerId).innerHTML = '<div class="empty-state"><p>Carregando...</p></div>';
  },

  showError(containerId, msg) {
    document.getElementById(containerId).innerHTML = `<div class="empty-state"><p style="color:var(--danger)">${msg}</p></div>`;
  },

  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  },

  formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR');
  },

  getStatusBadge(status, labels) {
    const map = labels || { pendente: 'Pendente', pago: 'Pago', recebido: 'Recebido', atrasado: 'Atrasado', vencido: 'Vencido', cancelado: 'Cancelado' };
    return `<span class="badge badge-${status}">${map[status] || status}</span>`;
  },

  route() {
    const hash = window.location.hash || '#/dashboard';
    const page = hash.split('?')[0].replace('#/', '');
    const pageName = page || 'dashboard';

    document.querySelectorAll('.nav-item').forEach(i => {
      i.classList.toggle('active', i.dataset.page === pageName);
    });

    const titles = {
      'dashboard': 'Dashboard',
      'contas-pagar': 'Contas a Pagar',
      'contas-receber': 'Contas a Receber',
      'relatorios': 'Relatórios',
      'configuracoes': 'Configurações'
    };
    document.getElementById('pageTitle').textContent = titles[pageName] || 'Dashboard';

    this.currentPage = pageName;
    const area = document.getElementById('contentArea');

    switch (pageName) {
      case 'dashboard': PageDashboard.render(area); break;
      case 'contas-pagar': PageContasPagar.render(area); break;
      case 'contas-receber': PageContasReceber.render(area); break;
      case 'relatorios': PageRelatorios.render(area); break;
      case 'configuracoes': PageAdmin.render(area); break;
      default: window.location.hash = '#/dashboard';
    }
  }
};

async function getCategorias() {
  try {
    return await API.get('/api/categorias');
  } catch (e) {}
  return [
    { nome: 'Salário', tipo: 'receita' }, { nome: 'Freelance', tipo: 'receita' },
    { nome: 'Investimentos', tipo: 'receita' }, { nome: 'Aluguel', tipo: 'despesa' },
    { nome: 'Água', tipo: 'despesa' }, { nome: 'Luz', tipo: 'despesa' },
    { nome: 'Internet', tipo: 'despesa' }, { nome: 'Telefone', tipo: 'despesa' },
    { nome: 'Alimentação', tipo: 'despesa' }, { nome: 'Transporte', tipo: 'despesa' },
    { nome: 'Saúde', tipo: 'despesa' }, { nome: 'Educação', tipo: 'despesa' },
    { nome: 'Lazer', tipo: 'despesa' }, { nome: 'Assinaturas', tipo: 'despesa' },
    { nome: 'Impostos', tipo: 'despesa' }, { nome: 'Outros', tipo: 'ambos' }
  ];
}

document.addEventListener('DOMContentLoaded', () => App.init());
