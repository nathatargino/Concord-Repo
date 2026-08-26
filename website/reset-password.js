/* ================================================
   CONCORD — Reset Password Page Logic
   Detects recovery token, verifies duplicate password,
   updates password in Supabase Auth, signs out and redirects.
   ================================================ */

document.addEventListener('DOMContentLoaded', async () => {

    // ---- Theme persistence ----
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('concord-theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);

    // ---- Password Toggle ----
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

    // Helper: Show feedback message
    function showMessage(form, message, isError = true) {
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
        setTimeout(() => msgEl.remove(), 8000);
    }

    // Helper: Button Loading
    function setButtonLoading(btn, loading) {
        if (loading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `
                <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Salvando alterações...
            `;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText;
        }
    }

    // Elements
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
    const savePasswordBtn = document.getElementById('savePasswordBtn');
    const invalidTokenState = document.getElementById('invalidTokenState');
    const resetFooter = document.getElementById('resetFooter');
    const cardHeader = document.querySelector('.auth-card-header');

    let currentUser = null;
    let isRecoveryMode = false;

    // Check if URL hash contains recovery token or access_token
    const hash = window.location.hash;
    const isRecoveryHash = hash.includes('type=recovery') || hash.includes('access_token=');

    // Listen for Auth state changes (Supabase handles recovery session automatically from hash)
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (session?.user && isRecoveryHash)) {
            isRecoveryMode = true;
            currentUser = session.user;
        }
    });

    // Also check current active session directly
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) {
            currentUser = session.user;
            isRecoveryMode = true;
        }
    } catch (e) {
        console.warn('Session check warning:', e);
    }

    // If after 1.5s there is no session and no hash token, show invalid state
    setTimeout(() => {
        if (!currentUser && !isRecoveryHash) {
            if (resetPasswordForm) resetPasswordForm.style.display = 'none';
            if (cardHeader) cardHeader.style.display = 'none';
            if (resetFooter) resetFooter.style.display = 'none';
            if (invalidTokenState) invalidTokenState.style.display = 'block';
        }
    }, 1500);

    // Form Submit
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newPassword = newPasswordInput.value;
            const confirmNewPassword = confirmNewPasswordInput.value;

            // Validações
            if (!newPassword || !confirmNewPassword) {
                showMessage(resetPasswordForm, 'Preencha todos os campos.', true);
                return;
            }

            if (newPassword.length < 6) {
                showMessage(resetPasswordForm, 'A nova senha deve ter pelo menos 6 caracteres.', true);
                return;
            }

            if (newPassword !== confirmNewPassword) {
                showMessage(resetPasswordForm, 'As senhas não coincidem. Por favor, verifique.', true);
                return;
            }

            setButtonLoading(savePasswordBtn, true);

            try {
                // Ensure we have current user
                if (!currentUser) {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session?.user) {
                        currentUser = session.user;
                    }
                }

                if (!currentUser?.email) {
                    setButtonLoading(savePasswordBtn, false);
                    showMessage(resetPasswordForm, 'Sessão de recuperação expirada. Solicite um novo link.', true);
                    return;
                }

                // 1. Check if newPassword is the exact same password already in use
                // Test login with current email and newPassword
                const { data: testSign, error: testErr } = await supabaseClient.auth.signInWithPassword({
                    email: currentUser.email,
                    password: newPassword
                });

                if (!testErr && testSign?.user) {
                    // Login succeeded -> It is the SAME password as before!
                    setButtonLoading(savePasswordBtn, false);
                    showMessage(resetPasswordForm, 'Esta senha já está em uso na sua conta. Por favor, escolha uma senha diferente.', true);
                    return;
                }

                // 2. New password is valid and different -> Update password in Supabase
                const { data: updateData, error: updateErr } = await supabaseClient.auth.updateUser({
                    password: newPassword
                });

                if (updateErr) {
                    setButtonLoading(savePasswordBtn, false);
                    showMessage(resetPasswordForm, 'Erro ao atualizar senha: ' + updateErr.message, true);
                    return;
                }

                // 3. Success! Show message, sign out user and redirect to login
                showMessage(resetPasswordForm, 'Senha alterada com sucesso! Desconectando sua conta para que você faça login com a nova senha...', false);

                // Sign out
                await supabaseClient.auth.signOut();

                // Redirect to login with success flag
                setTimeout(() => {
                    window.location.href = 'login.html?reset=success';
                }, 1800);

            } catch (err) {
                console.error('Password reset error:', err);
                setButtonLoading(savePasswordBtn, false);
                showMessage(resetPasswordForm, 'Erro de conexão: ' + (err.message || 'Tente novamente.'), true);
            }
        });
    }

});
