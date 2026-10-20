/**
 * Autenticação de servidores (Supabase Auth) - Geoportal de Matinhos.
 * Público em geral: sem login. Servidores: e-mail + senha criados pelo administrador.
 * Qualquer usuário autenticado é considerado "servidor" (cadastro aberto deve ficar DESLIGADO no Supabase).
 */
const GeoAuth = (() => {
    const cfg = window.GEO_SUPABASE || {};
    let client = null;
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
    const configured = () => !!(projectUrl() && cfg.anonKey && !/^sb_secret_/i.test(cfg.anonKey) && window.supabase && window.supabase.createClient);
    const isStaff = () => !!session;
    const email = () => (session && session.user && session.user.email) || '';
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function onChange(fn) { listeners.push(fn); }

    function setSession(s) {
        const before = isStaff();
        session = s || null;
        updateUI();
        if (before !== isStaff()) listeners.forEach(fn => { try { fn(isStaff()); } catch (e) { console.error(e); } });
    }

    function updateUI() {
        document.body.dataset.role = isStaff() ? 'staff' : 'public';
        const chip = $('user-chip');
        const btn = $('btn-login');
        if (chip) {
            chip.className = 'user-chip ' + (isStaff() ? 'staff' : 'public');
            chip.innerHTML = isStaff()
                ? `<i class="fa-solid fa-user-shield"></i> Servidor · ${esc(email())}`
                : `<i class="fa-solid fa-globe"></i> Acesso público`;
        }
        if (btn) {
            btn.innerHTML = isStaff()
                ? `<i class="fa-solid fa-right-from-bracket"></i> Sair`
                : `<i class="fa-solid fa-lock"></i> Entrar`;
            btn.title = isStaff() ? 'Encerrar sessão de servidor' : 'Login para servidores municipais';
        }
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
                <p class="login-sub">Exclusivo para servidores da Prefeitura de Matinhos. O público em geral continua com acesso livre às camadas públicas, sem login.</p>
                <form id="login-form" autocomplete="on">
                    <label for="login-email">E-mail institucional</label>
                    <input type="email" id="login-email" name="email" autocomplete="username" required>
                    <label for="login-pass">Senha</label>
                    <input type="password" id="login-pass" name="password" autocomplete="current-password" required>
                    <div class="login-error" id="login-error" role="alert"></div>
                    <button type="submit" class="login-submit" id="login-submit"><i class="fa-solid fa-right-to-bracket"></i> Entrar</button>
                </form>
            </div>`;
        document.body.appendChild(m);
        $('login-close').addEventListener('click', closeLogin);
        m.addEventListener('mousedown', e => { if (e.target === m) closeLogin(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) closeLogin(); });
        $('login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const err = $('login-error');
            const submit = $('login-submit');
            err.textContent = '';
            if (!configured()) {
                err.textContent = 'O login ainda não foi configurado neste portal (veja LEIA-ME_LOGIN.md).';
                return;
            }
            submit.disabled = true;
            submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';
            try {
                await signIn($('login-email').value.trim(), $('login-pass').value);
                $('login-pass').value = '';
                closeLogin();
            } catch (ex) {
                err.textContent = ex.message || 'Não foi possível entrar.';
            } finally {
                submit.disabled = false;
                submit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Entrar';
            }
        });
    }

    function openLogin() {
        buildModal();
        $('login-error').textContent = configured() ? '' : 'O login ainda não foi configurado neste portal (veja LEIA-ME_LOGIN.md).';
        $('login-modal').classList.add('open');
        setTimeout(() => $('login-email').focus(), 50);
    }
    function closeLogin() { const m = $('login-modal'); if (m) m.classList.remove('open'); }

    async function signIn(mail, pass) {
        const { error } = await client.auth.signInWithPassword({ email: mail, password: pass });
        if (error) {
            if (/invalid login/i.test(error.message)) throw new Error('E-mail ou senha incorretos.');
            if (/email not confirmed/i.test(error.message)) throw new Error('E-mail ainda não confirmado. Fale com o administrador.');
            throw new Error('Falha no login: ' + error.message);
        }
    }

    async function signOut() {
        if (client) await client.auth.signOut();
        setSession(null);
    }

    /** Baixa um arquivo JSON do bucket privado (só funciona com sessão de servidor). */
    async function fetchJSON(path) {
        if (!client || !isStaff()) throw new Error('Sem sessão de servidor.');
        const { data, error } = await client.storage.from(cfg.bucket || 'restrito').download(path);
        if (error) throw new Error(error.message || 'Falha ao baixar ' + path);
        return JSON.parse(await data.text());
    }

    function init() {
        buildModal();
        const btn = $('btn-login');
        if (btn) btn.addEventListener('click', () => { isStaff() ? signOut() : openLogin(); });
        updateUI();
        if (!configured()) return;
        client = window.supabase.createClient(projectUrl(), cfg.anonKey);
        client.auth.getSession().then(({ data }) => setSession(data.session));
        client.auth.onAuthStateChange((_evt, s) => setSession(s));
    }

    return { init, isStaff, email, onChange, fetchJSON, openLogin, configured, manifest: cfg.manifest || 'config_restrito.json' };
})();
