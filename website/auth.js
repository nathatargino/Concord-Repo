/* ================================================
   CONCORD — Auth Pages JavaScript
   Theme, Password Toggle, Supabase Auth
   ================================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ---- Theme: persist from main site ----
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('concord-theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);

    // ---- Toggle Password Visibility ----
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';

            if (isPassword) {
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
            } else {
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
            }
        });
    });

    // ---- Helper: Show auth feedback message ----
    function showAuthMessage(form, message, isError = true) {
        // Remove previous message
        const prev = form.querySelector('.auth-message');
        if (prev) prev.remove();

        const msgEl = document.createElement('div');
        msgEl.className = `auth-message ${isError ? 'auth-message-error' : 'auth-message-success'}`;
        msgEl.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isError
                    ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
                    : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                }
            </svg>
            <span>${message}</span>
        `;
        form.insertBefore(msgEl, form.firstChild);

        // Auto-remove after 8 seconds
        setTimeout(() => msgEl.remove(), 8000);
    }

    // ---- Helper: Set button loading state ----
    function setButtonLoading(btn, loading) {
        if (loading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `
                <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Aguarde...
            `;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText;
        }
    }

    // ============================================
    //  LOGIN — Verificar credenciais no Supabase
    // ============================================
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            // Validação básica
            if (!email || !password) {
                showAuthMessage(loginForm, 'Preencha todos os campos.', true);
                return;
            }

            setButtonLoading(submitBtn, true);

            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                setButtonLoading(submitBtn, false);

                if (error) {
                    let msg = 'Usuário ou senha está incorreto.';
                    if (error.message.includes('Email not confirmed')) {
                        msg = 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e clique no link de confirmação.';
                    } else if (error.message.includes('Invalid login')) {
                        msg = 'Usuário ou senha está incorreto.';
                    }
                    showAuthMessage(loginForm, msg, true);
                    return;
                }

                // Login OK — redirecionar para o site
                showAuthMessage(loginForm, 'Login realizado com sucesso! Redirecionando...', false);
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1200);

            } catch (err) {
                console.error("Login Error:", err);
                setButtonLoading(submitBtn, false);
                showAuthMessage(loginForm, 'Erro de conexão: ' + (err.message || 'Tente novamente.'), true);
            }
        });
    }

    // ============================================
    //  REGISTRO — Criar conta no Supabase
    // ============================================
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('regName').value.trim();
            const email = document.getElementById('regEmail').value.trim();
            const password = document.getElementById('regPassword').value;
            const confirmPassword = document.getElementById('regConfirmPassword').value;
            const submitBtn = registerForm.querySelector('button[type="submit"]');

            // Validações
            if (!name || !email || !password || !confirmPassword) {
                showAuthMessage(registerForm, 'Preencha todos os campos.', true);
                return;
            }

            if (password !== confirmPassword) {
                showAuthMessage(registerForm, 'As senhas não coincidem. Por favor, verifique.', true);
                return;
            }

            if (password.length < 6) {
                showAuthMessage(registerForm, 'A senha deve ter pelo menos 6 caracteres.', true);
                return;
            }

            setButtonLoading(submitBtn, true);

            try {
                // Verificar se o nome de usuário (username) já está em uso no banco
                const { data: existingUser } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .ilike('username', name)
                    .maybeSingle();

                if (existingUser) {
                    setButtonLoading(submitBtn, false);
                    showAuthMessage(registerForm, 'Este nome de usuário já está em uso. Por favor, escolha outro.', true);
                    return;
                }

                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            display_name: name,
                            username: name
                        }
                    }
                });

                setButtonLoading(submitBtn, false);

                if (error) {
                    let msg = 'Erro ao criar conta. Tente novamente.';
                    if (error.message.includes('already registered') || error.message.includes('already been registered')) {
                        msg = 'Este e-mail já está cadastrado. Tente fazer login.';
                    } else if (error.message.includes('valid email')) {
                        msg = 'Por favor, insira um e-mail válido.';
                    } else if (error.message.includes('at least') || error.message.includes('password')) {
                        msg = 'A senha deve ter pelo menos 6 caracteres.';
                    }
                    showAuthMessage(registerForm, msg, true);
                    return;
                }

                // Verificar se o e-mail já existia (Supabase retorna identities vazio)
                if (data?.user?.identities?.length === 0) {
                    showAuthMessage(registerForm, 'Este e-mail já está cadastrado. Tente fazer login.', true);
                    return;
                }

                // Conta criada com sucesso!
                // Esconder formulário, cabeçalho e rodapé
                registerForm.style.display = 'none';
                
                const cardHeader = document.querySelector('.auth-card-header');
                if (cardHeader) cardHeader.style.display = 'none';
                
                const footer = document.getElementById('registerFooter');
                if (footer) footer.style.display = 'none';

                // Mostrar tela de sucesso
                const successState = document.getElementById('registerSuccessState');
                if (successState) successState.style.display = 'block';

            } catch (err) {
                console.error("Register Error:", err);
                setButtonLoading(submitBtn, false);
                showAuthMessage(registerForm, 'Erro de conexão: ' + (err.message || 'Tente novamente.'), true);
            }
        });
    }

    // ============================================
    //  GOOGLE — Login/Registro com Google OAuth
    // ============================================

    // Google Sign In (tela de login)
    document.getElementById('googleSignIn')?.addEventListener('click', async () => {
        try {
            const { data, error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin + '/index.html'
                }
            });

            if (error) {
                const form = document.getElementById('loginForm');
                if (form) showAuthMessage(form, 'Erro ao conectar com Google. Tente novamente.', true);
            }
            // Se der certo, o Supabase redireciona automaticamente para o Google
        } catch (err) {
            const form = document.getElementById('loginForm');
            if (form) showAuthMessage(form, 'Erro de conexão. Tente novamente.', true);
        }
    });

    // Google Sign Up (tela de registro)
    document.getElementById('googleSignUp')?.addEventListener('click', async () => {
        try {
            const { data, error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin + '/index.html'
                }
            });

            if (error) {
                const form = document.getElementById('registerForm');
                if (form) showAuthMessage(form, 'Erro ao conectar com Google. Tente novamente.', true);
            }
            // Se der certo, o Supabase redireciona automaticamente para o Google
        } catch (err) {
            const form = document.getElementById('registerForm');
            if (form) showAuthMessage(form, 'Erro de conexão. Tente novamente.', true);
        }
    });

    // ============================================
    //  ESQUECEU A SENHA — Recuperação por e-mail
    // ============================================
    document.querySelector('.forgot-password')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail')?.value?.trim();

        if (!email) {
            showAuthMessage(loginForm, 'Digite seu e-mail no campo acima para recuperar a senha.', true);
            return;
        }

        try {
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/reset-password.html'
            });

            if (error) {
                showAuthMessage(loginForm, 'Erro ao enviar e-mail de recuperação: ' + error.message, true);
            } else {
                showAuthMessage(loginForm, 'E-mail de recuperação enviado com sucesso! Verifique sua caixa de entrada.', false);
            }
        } catch (err) {
            showAuthMessage(loginForm, 'Erro de conexão. Tente novamente.', true);
        }
    });

    // ============================================
    //  SESSÃO & URL PARAMS
    // ============================================
    async function checkSessionAndParams() {
        // Se a URL contiver hash de recuperação, redirecionar para reset-password.html
        if (window.location.hash.includes('type=recovery')) {
            window.location.href = 'reset-password.html' + window.location.hash;
            return;
        }

        // Se veio de uma redefinição com sucesso
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('reset') === 'success' && loginForm) {
            showAuthMessage(loginForm, 'Sua senha foi redefinida com sucesso! Por favor, faça login com sua nova senha.', false);
        }

        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && urlParams.get('reset') !== 'success') {
                // Já está logado, ir direto para o site
                window.location.href = 'index.html';
            }
        } catch (err) {
            // Ignora erro silenciosamente
        }
    }
    checkSessionAndParams();

});
