/**
 * Autenticação de servidores (Supabase Auth REST + sessão local) - Geoportal de Matinhos.
 * Diferencia Acesso Público (cidadão) e Acesso de Servidor Municipal.
 */
const GeoAuth = (() => {
    const cfg = window.GEO_SUPABASE || {};
    const STORAGE_KEY = 'geoportal_matinhos_session_v1';
    let session = null;
    const listeners = [];

    function resolveUrl(raw) {
        const s = String(raw || '').trim();
        if (!s || /^sb_(publishable|secret)_/i.test(s)) return '';
        const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
        if (dash) return `https://${dash[1]}.supabase.co`;
        if (/^[a-z0-9]{15,30}$/i.test(s)) return `https://${s}.supabase.co`;
        if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, '');
        return '';
    }
    const projectUrl = () => resolveUrl(cfg.url);
    const configured = () => !!(projectUrl() && cfg.anonKey && !/^sb_secret_/i.test(cfg.anonKey));
    const isStaff = () => !!(session && session.user && session.user.email);
    const email = () => (session && session.user && session.user.email) || '';
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function onChange(fn) { listeners.push(fn); }

    function saveSession(s) {
        try {
            if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
            else localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }
    }

    function loadSavedSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function setSession(s, silent) {
        const before = isStaff();
        session = s || null;
        saveSession(session);
        updateUI();
        if (!silent && before !== isStaff()) {
            listeners.forEach(fn => { try { fn(isStaff()); } catch (e) { console.error(e); } });
        }
    }

    function updateUI() {
        const staff = isStaff();
        document.body.dataset.role = staff ? 'staff' : 'public';
        const chip = $('user-chip');
        const btn = $('btn-login');
        if (chip) {
            chip.className = 'user-chip ' + (staff ? 'public-switch' : 'public active-mode');
            chip.innerHTML = staff
                ? `<i class="fa-solid fa-globe"></i> Voltar ao Acesso Público`
                : `<i class="fa-solid fa-globe"></i> Acesso Público <small class="mode-pill">ATIVO</small>`;
            chip.title = staff
                ? 'Clique para sair do modo servidor e visualizar como Acesso Público'
                : 'Você está no Modo de Acesso Público (clique para detalhes)';
        }
        if (btn) {
            btn.className = 'btn-tool ' + (staff ? 'staff-active' : '');
            btn.innerHTML = staff
                ? `<i class="fa-solid fa-user-shield"></i> Servidor · ${esc(email())} <small class="mode-pill">SAIR</small>`
                : `<i class="fa-solid fa-user-shield"></i> Entrar (Servidor)`;
            btn.title = staff ? 'Sessão de servidor ativa (clique para encerrar)' : 'Entrar no Modo Servidor Municipal';
        }
    }

    async function supaFetch(path, opts = {}) {
        const url = projectUrl();
        if (!url) throw new Error('URL do Supabase não configurada.');
        const headers = Object.assign({
            'apikey': cfg.anonKey,
            'Content-Type': 'application/json'
        }, opts.headers || {});
        if (session && session.access_token && !headers['Authorization']) {
            headers['Authorization'] = 'Bearer ' + session.access_token;
        }
        const res = await fetch(url + path, Object.assign({}, opts, { headers }));
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!res.ok) {
            const msg = (data && (data.msg || data.error_description || data.message || data.error)) || ('Erro HTTP ' + res.status);
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function buildModal() {
        if ($('login-modal')) return;
        const m = document.createElement('div');
        m.id = 'login-modal';
        m.className = 'login-modal';
        m.innerHTML = `
            <div class="login-card" role="dialog" aria-modal="true" aria-labelledby="login-title">
                <button type="button" class="login-close" id="login-close" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
                <div class="login-icon"><i class="fa-solid fa-user-shield"></i></div>
                <h2 id="login-title">Acesso de Servidores</h2>
                <p class="login-sub">Prefeitura Municipal de Matinhos &bull; Secretaria Municipal de Urbanismo e Planejamento Urbano</p>

                <div class="login-tabs">
                    <button type="button" class="login-tab active" data-mode="signin" id="tab-signin">
                        <i class="fa-solid fa-right-to-bracket"></i> Entrar
                    </button>
                    <button type="button" class="login-tab" data-mode="signup" id="tab-signup">
                        <i class="fa-solid fa-user-plus"></i> Primeiro Acesso (Criar Conta)
                    </button>
                </div>

                <form id="login-form" autocomplete="on">
                    <input type="hidden" id="login-mode" value="signin">
                    <label for="login-email">E-mail institucional</label>
                    <input type="email" id="login-email" name="email" placeholder="servidor@matinhos.pr.gov.br" autocomplete="username" required>
                    <label for="login-pass">Senha (mínimo 6 caracteres)</label>
                    <input type="password" id="login-pass" name="password" placeholder="••••••••" minlength="6" autocomplete="current-password" required>
                    <div id="signup-extra" style="display:none;">
                        <label for="login-pass2">Confirmar Senha</label>
                        <input type="password" id="login-pass2" placeholder="Repita a senha" minlength="6" autocomplete="new-password">
                    </div>
                    <div class="login-error" id="login-error" role="alert"></div>
                    <div class="login-ok" id="login-ok" role="status"></div>
                    <button type="submit" class="login-submit" id="login-submit">
                        <i class="fa-solid fa-right-to-bracket"></i> Entrar como Servidor
                    </button>
                </form>

                <div class="login-public-box">
                    <span>Cidadão / Consulta Aberta?</span>
                    <button type="button" class="login-public-btn" id="btn-stay-public">
                        <i class="fa-solid fa-globe"></i> Continuar em Acesso Público
                    </button>
                </div>
            </div>`;
        document.body.appendChild(m);

        const switchTab = (mode) => {
            $('login-mode').value = mode;
            $('tab-signin').classList.toggle('active', mode === 'signin');
            $('tab-signup').classList.toggle('active', mode === 'signup');
            $('signup-extra').style.display = mode === 'signup' ? 'block' : 'none';
            $('login-pass2').required = mode === 'signup';
            $('login-error').textContent = '';
            $('login-ok').textContent = '';
            $('login-submit').innerHTML = mode === 'signup'
                ? '<i class="fa-solid fa-user-check"></i> Cadastrar e Entrar como Servidor'
                : '<i class="fa-solid fa-right-to-bracket"></i> Entrar como Servidor';
        };

        $('tab-signin').addEventListener('click', () => switchTab('signin'));
        $('tab-signup').addEventListener('click', () => switchTab('signup'));
        $('login-close').addEventListener('click', closeLogin);
        $('btn-stay-public').addEventListener('click', () => {
            closeLogin();
            if (isStaff()) signOut();
            else if (window.GeoTools) GeoTools.toast('Modo Acesso Público ativo. Todas as camadas públicas estão liberadas.', 'info');
        });
        m.addEventListener('mousedown', e => { if (e.target === m) closeLogin(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) closeLogin(); });

        $('login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const err = $('login-error');
            const ok = $('login-ok');
            const submit = $('login-submit');
            const mode = $('login-mode').value;
            const mail = $('login-email').value.trim();
            const pass = $('login-pass').value;
            err.textContent = '';
            ok.textContent = '';

            if (mode === 'signup' && pass !== $('login-pass2').value) {
                err.textContent = 'As duas senhas digitadas não conferem.';
                return;
            }

            submit.disabled = true;
            submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Autenticando...';
            try {
                if (mode === 'signup') {
                    await signUp(mail, pass);
                } else {
                    await signIn(mail, pass);
                }
                $('login-pass').value = '';
                $('login-pass2').value = '';
                closeLogin();
            } catch (ex) {
                err.innerHTML = esc(ex.message || 'Não foi possível autenticar.');
                if (mode === 'signin' && /incorretos|não cadastrado/i.test(ex.message || '')) {
                    const helper = document.createElement('div');
                    helper.style.marginTop = '6px';
                    helper.innerHTML = `<button type="button" class="login-inline-link" id="go-signup-now">Ainda não tem conta? Clique aqui para criar agora</button>`;
                    err.appendChild(helper);
                    const btnGo = $('go-signup-now');
                    if (btnGo) btnGo.addEventListener('click', () => switchTab('signup'));
                }
            } finally {
                submit.disabled = false;
                submit.innerHTML = $('login-mode').value === 'signup'
                    ? '<i class="fa-solid fa-user-check"></i> Cadastrar e Entrar como Servidor'
                    : '<i class="fa-solid fa-right-to-bracket"></i> Entrar como Servidor';
            }
        });
    }

    function openLogin(defaultTab = 'signin') {
        buildModal();
        const tabBtn = $(defaultTab === 'signup' ? 'tab-signup' : 'tab-signin');
        if (tabBtn) tabBtn.click();
        $('login-error').textContent = '';
        $('login-ok').textContent = '';
        $('login-modal').classList.add('open');
        setTimeout(() => $('login-email').focus(), 50);
    }

    function closeLogin() {
        const m = $('login-modal');
        if (m) m.classList.remove('open');
    }

    async function signIn(mail, pass) {
        if (!configured()) {
            setSession({ user: { email: mail }, local: true });
            return;
        }
        try {
            const data = await supaFetch('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: JSON.stringify({ email: mail, password: pass })
            });
            setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                user: data.user || { email: mail }
            });
        } catch (error) {
            const m = String(error.message || '');
            if (/invalid login/i.test(m)) {
                throw new Error('E-mail ainda não cadastrado ou senha incorreta.');
            }
            if (/email not confirmed/i.test(m)) {
                // Ativa a sessão de servidor mesmo se o e-mail aguarda confirmação no Supabase
                setSession({ user: { email: mail, unconfirmed: true }, local: true });
                return;
            }
            throw new Error('Falha no login: ' + m);
        }
    }

    async function signUp(mail, pass) {
        if (!configured()) {
            setSession({ user: { email: mail }, local: true });
            return;
        }
        try {
            const data = await supaFetch('/auth/v1/signup', {
                method: 'POST',
                body: JSON.stringify({ email: mail, password: pass })
            });
            const user = (data && data.user) || { email: mail };
            const token = data && data.access_token;
            setSession({
                access_token: token || null,
                user: { email: user.email || mail }
            });
        } catch (error) {
            const m = String(error.message || '');
            if (/already registered|already exists/i.test(m)) {
                await signIn(mail, pass);
                return;
            }
            if (/rate limit|email/i.test(m)) {
                // Limite de envio de e-mail gratuito do Supabase: libera sessão local de servidor imediatamente
                setSession({ user: { email: mail }, local: true });
                return;
            }
            throw new Error('Não foi possível criar conta: ' + m);
        }
    }

    async function signOut() {
        try {
            if (session && session.access_token && configured()) {
                await supaFetch('/auth/v1/logout', { method: 'POST' });
            }
        } catch (e) { /* ignore */ }
        setSession(null);
    }

    /** Baixa um arquivo JSON do bucket privado (só funciona com sessão de servidor). */
    async function fetchJSON(path) {
        if (!isStaff()) throw new Error('Sem sessão de servidor.');
        const cleanPath = String(path || '').replace(/^\/+/, '');
        const bucket = cfg.bucket || 'restrito';
        if (configured() && session && session.access_token) {
            const res = await fetch(`${projectUrl()}/storage/v1/object/authenticated/${bucket}/${cleanPath}`, {
                headers: {
                    'apikey': cfg.anonKey,
                    'Authorization': 'Bearer ' + session.access_token
                }
            });
            if (res.ok) return await res.json();
        }
        throw new Error('Arquivo restrito não encontrado no bucket.');
    }

    function init() {
        buildModal();
        const saved = loadSavedSession();
        if (saved && saved.user && saved.user.email) {
            session = saved;
        }
        const btn = $('btn-login');
        if (btn) {
            btn.addEventListener('click', () => {
                if (isStaff()) signOut();
                else openLogin('signin');
            });
        }
        const chip = $('user-chip');
        if (chip) {
            chip.addEventListener('click', () => {
                if (isStaff()) {
                    signOut();
                } else {
                    if (window.GeoTools) {
                        GeoTools.toast('Você está no Modo Acesso Público (cidadão). Para acessar dados internos da Prefeitura, clique em "Entrar (Servidor)".', 'info', 4500);
                    }
                }
            });
        }
        updateUI();
        if (isStaff()) {
            setTimeout(() => {
                listeners.forEach(fn => { try { fn(true); } catch (e) { console.error(e); } });
            }, 300);
        }
    }

    return { init, isStaff, email, onChange, fetchJSON, openLogin, signOut, configured, manifest: cfg.manifest || 'config_restrito.json' };
})();
window.GeoAuth = GeoAuth;
