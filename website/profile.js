/* ================================================
   CONCORD — Profile Management JavaScript
   Tabs, Change Username with Supabase validation,
   Send Password Reset Email
   ================================================ */

document.addEventListener('DOMContentLoaded', async () => {

    // ---- Theme persistence ----
    const html = document.documentElement;
    const savedTheme = localStorage.getItem('concord-theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);

    // Helper: Initials
    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    // Helper: Show alert message inside form
    function showMessage(container, message, isError = true) {
        const prev = container.querySelector('.auth-message');
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
        container.insertBefore(msgEl, container.firstChild);
        setTimeout(() => msgEl.remove(), 7000);
    }

    // Helper: Button loading state
    function setButtonLoading(btn, loading) {
        if (loading) {
            btn.dataset.originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `
                <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Salvando...
            `;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.dataset.originalText;
        }
    }

    // Elements
    const profileAvatar = document.getElementById('profileAvatar');
    const profileDisplayName = document.getElementById('profileDisplayName');
    const profileDisplayEmail = document.getElementById('profileDisplayEmail');
    const passwordTargetEmail = document.getElementById('passwordTargetEmail');
    const newUsernameInput = document.getElementById('newUsernameInput');
    const changeUsernameForm = document.getElementById('changeUsernameForm');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    const tabBtnUsername = document.getElementById('tabBtnUsername');
    const tabBtnPassword = document.getElementById('tabBtnPassword');
    const tabContentUsername = document.getElementById('tabContentUsername');
    const tabContentPassword = document.getElementById('tabContentPassword');
    const sendResetEmailBtn = document.getElementById('sendResetEmailBtn');
    const resendEmailBtn = document.getElementById('resendEmailBtn');
    const passwordRequestState = document.getElementById('passwordRequestState');
    const passwordSentState = document.getElementById('passwordSentState');
    const sentConfirmEmail = document.getElementById('sentConfirmEmail');

    // ---- Tab Switching (Attach Immediately) ----
    function switchTab(tabName) {
        if (tabName === 'password') {
            tabBtnPassword?.classList.add('active');
            tabBtnUsername?.classList.remove('active');
            tabContentPassword?.classList.add('active');
            tabContentUsername?.classList.remove('active');
            window.location.hash = 'password';
        } else {
            tabBtnUsername?.classList.add('active');
            tabBtnPassword?.classList.remove('active');
            tabContentUsername?.classList.add('active');
            tabContentPassword?.classList.remove('active');
            window.location.hash = 'username';
        }
    }

    tabBtnUsername?.addEventListener('click', () => switchTab('username'));
    tabBtnPassword?.addEventListener('click', () => switchTab('password'));

    if (window.location.hash === '#password') {
        switchTab('password');
    }

    // ---- Check Session ----
    let currentUser = null;
    let currentDisplayName = localStorage.getItem('concord_username') || 'Usuário';

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) {
            currentUser = session.user;
            const meta = currentUser.user_metadata || {};
            currentDisplayName = meta.display_name || meta.username || currentUser.email.split('@')[0];

            const { data: profileData } = await supabaseClient
                .from('profiles')
                .select('username, avatar_url')
                .eq('id', currentUser.id)
                .maybeSingle();

            if (profileData?.username) {
                currentDisplayName = profileData.username;
            }

            if (profileDisplayName) profileDisplayName.textContent = currentDisplayName;
            if (profileDisplayEmail) profileDisplayEmail.textContent = currentUser.email;
            if (passwordTargetEmail) passwordTargetEmail.textContent = currentUser.email;
            if (newUsernameInput) newUsernameInput.value = currentDisplayName;

            if (profileData?.avatar_url || meta.avatar_url) {
                const url = profileData?.avatar_url || meta.avatar_url;
                if (profileAvatar) profileAvatar.innerHTML = `<img src="${url}" alt="${currentDisplayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else if (profileAvatar) {
                profileAvatar.textContent = getInitials(currentDisplayName);
            }
        } else {
            // Fallback for local user
            if (profileDisplayName) profileDisplayName.textContent = currentDisplayName;
            if (profileDisplayEmail) profileDisplayEmail.textContent = 'Conta Local';
            if (newUsernameInput) newUsernameInput.value = currentDisplayName;
            if (profileAvatar) profileAvatar.textContent = getInitials(currentDisplayName);
        }

    } catch (err) {
        console.warn('Session check warning:', err);
    }

    // ---- TAB 1: Change Username ----
    changeUsernameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUsername = newUsernameInput.value.trim();

        if (!newUsername) {
            showMessage(changeUsernameForm, 'Por favor, digite um nome de usuário válido.', true);
            return;
        }

        if (newUsername.length < 2 || newUsername.length > 32) {
            showMessage(changeUsernameForm, 'O nome de usuário deve ter entre 2 e 32 caracteres.', true);
            return;
        }

        if (newUsername.toLowerCase() === currentDisplayName.toLowerCase()) {
            showMessage(changeUsernameForm, 'O nome de usuário inserido é o mesmo que você já está usando.', true);
            return;
        }

        setButtonLoading(saveUsernameBtn, true);

        try {
            if (currentUser) {
                // Check if username already exists in public.profiles table (case-insensitive)
                const { data: existingUser, error: queryErr } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .ilike('username', newUsername)
                    .neq('id', currentUser.id)
                    .maybeSingle();

                if (queryErr) {
                    console.warn('Profile search warning:', queryErr);
                }

                if (existingUser) {
                    setButtonLoading(saveUsernameBtn, false);
                    showMessage(changeUsernameForm, 'Este nome de usuário já está em uso por outra conta. Por favor, escolha outro.', true);
                    return;
                }

                // 1. Update public.profiles
                const { error: profileErr } = await supabaseClient
                    .from('profiles')
                    .update({ 
                        username: newUsername,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', currentUser.id);

                if (profileErr) {
                    console.error('Update profiles error:', profileErr);
                    setButtonLoading(saveUsernameBtn, false);
                    showMessage(changeUsernameForm, 'Erro ao salvar alterações no perfil: ' + profileErr.message, true);
                    return;
                }

                // 2. Update Auth metadata
                await supabaseClient.auth.updateUser({
                    data: {
                        username: newUsername,
                        display_name: newUsername
                    }
                });
            }

            // 3. Update localStorage
            localStorage.setItem('concord_username', newUsername);
            localStorage.setItem('concord_username_v1', newUsername);
            currentDisplayName = newUsername;

            // 4. Update UI
            if (profileDisplayName) profileDisplayName.textContent = newUsername;
            if (profileAvatar) profileAvatar.textContent = getInitials(newUsername);
            setButtonLoading(saveUsernameBtn, false);

            showMessage(changeUsernameForm, `Nome de usuário alterado com sucesso para "${newUsername}"!`, false);

        } catch (err) {
            console.error('Error updating username:', err);
            setButtonLoading(saveUsernameBtn, false);
            showMessage(changeUsernameForm, 'Erro de conexão ao salvar: ' + (err.message || 'Tente novamente.'), true);
        }
    });

    // ---- TAB 2: Send Password Reset Email ----
    async function handleSendResetEmail(btn) {
        if (!currentUser?.email) return;

        setButtonLoading(btn, true);

        try {
            // Define redirect URL pointing to reset-password.html on the site
            const redirectTo = window.location.origin + '/reset-password.html';

            const { error } = await supabaseClient.auth.resetPasswordForEmail(currentUser.email, {
                redirectTo
            });

            setButtonLoading(btn, false);

            if (error) {
                let msg = error.message;
                if (error.message.toLowerCase().includes('rate limit') || error.status === 429) {
                    msg = 'Limite de envios temporário atingido. Por segurança do servidor de e-mail contra spam, aguarde alguns minutos antes de tentar novamente.';
                }
                showMessage(tabContentPassword, msg, true);
                return;
            }

            // Show beautiful success state
            passwordRequestState.style.display = 'none';
            if (sentConfirmEmail) sentConfirmEmail.textContent = currentUser.email;
            passwordSentState.style.display = 'block';

        } catch (err) {
            console.error('Error sending reset email:', err);
            setButtonLoading(btn, false);
            showMessage(tabContentPassword, 'Erro ao conectar: ' + (err.message || 'Tente novamente.'), true);
        }
    }

    sendResetEmailBtn?.addEventListener('click', () => handleSendResetEmail(sendResetEmailBtn));
    resendEmailBtn?.addEventListener('click', () => handleSendResetEmail(resendEmailBtn));

});
