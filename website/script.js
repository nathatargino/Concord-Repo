/* ================================================
   CONCORD — JavaScript
   Theme Toggle, Auth Tabs, Mobile Menu, Animations
   ================================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ---- Theme Toggle ----
    const themeToggle = document.getElementById('themeToggle');
    const html = document.documentElement;

    // Default to dark theme on first visit
    const savedTheme = localStorage.getItem('concord-theme');
    const initialTheme = savedTheme || 'dark';
    html.setAttribute('data-theme', initialTheme);
    if (!savedTheme) localStorage.setItem('concord-theme', 'dark');

    themeToggle.addEventListener('click', () => {
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('concord-theme', next);
    });



    // ---- Mobile Menu ----
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navLinks = document.getElementById('navLinks');
    let overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);

    function toggleMenu() {
        mobileMenuBtn.classList.toggle('active');
        navLinks.classList.toggle('active');
        overlay.classList.toggle('active');
        document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
    }

    mobileMenuBtn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', toggleMenu);

    // Close mobile menu on link click
    navLinks.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (navLinks.classList.contains('active')) {
                toggleMenu();
            }
        });
    });

    // ---- Navbar Scroll Effect ----
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });

    // ---- Intersection Observer for Animations (Scroll Reveal) ----
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    };

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                entry.target.classList.add('aos-animate');
                revealObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll, [data-aos]').forEach(el => {
        revealObserver.observe(el);
    });

    // ---- 3D Tilt Effect on Hero UI Mockup ----
    const mockupWrapper = document.querySelector('.hero-mockup-wrapper');
    const heroMockup = document.querySelector('.hero-mockup');

    if (mockupWrapper && heroMockup) {
        mockupWrapper.addEventListener('mousemove', (e) => {
            const rect = mockupWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            // Limit tilt angles for smooth premium feel
            const rotateX = ((y - centerY) / centerY) * -4;
            const rotateY = ((x - centerX) / centerX) * 4;

            heroMockup.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
        });

        mockupWrapper.addEventListener('mouseleave', () => {
            heroMockup.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        });
    }

    // ---- Stat Counter Animation ----
    const statObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const statNumbers = entry.target.querySelectorAll('.stat-number');
                statNumbers.forEach(num => {
                    const target = parseInt(num.getAttribute('data-count'));
                    animateCount(num, 0, target, 1500);
                });
                statObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    const heroStats = document.querySelector('.hero-stats');
    if (heroStats) statObserver.observe(heroStats);

    function animateCount(el, start, end, duration) {
        const range = end - start;
        const startTime = performance.now();
        
        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + range * eased);
            
            el.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }
        
        requestAnimationFrame(update);
    }

    // ---- Smooth scroll for anchor links ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ---- Active nav link highlight on scroll ----
    const sections = document.querySelectorAll('section[id]');
    
    window.addEventListener('scroll', () => {
        const scrollY = window.pageYOffset;
        
        sections.forEach(section => {
            const sectionHeight = section.offsetHeight;
            const sectionTop = section.offsetTop - 100;
            const sectionId = section.getAttribute('id');
            
            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                document.querySelectorAll('.nav-link').forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    });

    // ---- Supabase Auth State Management ----
    const navAuth = document.getElementById('navAuth');
    const navUser = document.getElementById('navUser');
    const navUserAvatar = document.getElementById('navUserAvatar');
    const navUserName = document.getElementById('navUserName');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');
    const logoutBtn = document.getElementById('logoutBtn');
    const dropdownAvatar = document.getElementById('dropdownAvatar');
    const dropdownName = document.getElementById('dropdownName');
    const dropdownEmail = document.getElementById('dropdownEmail');

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }

    const heroCtaBtn = document.getElementById('heroCtaBtn');
    const heroCtaText = document.getElementById('heroCtaText');

    function updateNavForUser(user) {
        if (!navAuth || !navUser) return;

        if (user) {
            const meta = user.user_metadata || {};
            const displayName = meta.display_name || meta.full_name || meta.username || user.email.split('@')[0];
            const initials = getInitials(displayName);
            const avatarUrl = meta.avatar_url;

            // Update nav
            navAuth.style.display = 'none';
            navUser.style.display = 'flex';
            navUserName.textContent = displayName;

            if (avatarUrl) {
                navUserAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                if (dropdownAvatar) dropdownAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                navUserAvatar.textContent = initials;
                if (dropdownAvatar) dropdownAvatar.textContent = initials;
            }

            if (dropdownName) dropdownName.textContent = displayName;
            if (dropdownEmail) dropdownEmail.textContent = user.email;

            // Update Hero button
            if (heroCtaBtn && heroCtaText) {
                heroCtaBtn.href = 'https://concord-olive.vercel.app/';
                heroCtaBtn.target = '_blank';
                heroCtaText.textContent = 'Entrar no Concord';
            }
        } else {
            navAuth.style.display = 'flex';
            navUser.style.display = 'none';

            // Reset Hero button
            if (heroCtaBtn && heroCtaText) {
                heroCtaBtn.href = 'login.html';
                heroCtaBtn.removeAttribute('target');
                heroCtaText.textContent = 'Começar Agora';
            }
        }
    }

    // Toggle user dropdown
    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (userDropdown && !userDropdown.contains(e.target) && !userMenuBtn.contains(e.target)) {
                userDropdown.classList.remove('active');
            }
        });
    }

    // Modais e Funções Globais
    window.abrirModal = function(idModal) {
        const modal = document.getElementById(idModal);
        if (modal) modal.style.display = 'flex';
    };

    window.fecharModal = function(idModal) {
        const modal = document.getElementById(idModal);
        if (modal) {
            modal.style.display = 'none';
            const msgEl = modal.querySelector('[id^="msg-alterar-"]');
            if (msgEl) msgEl.style.display = 'none';
        }
    };

    window.addEventListener('click', (event) => {
        if (event.target && event.target.classList && event.target.classList.contains('modal-concord')) {
            event.target.style.display = 'none';
        }
    });

    // Alterar Nome de Usuário — Abrir Modal
    const changeUsernameBtn = document.getElementById('changeUsernameBtn');
    if (changeUsernameBtn) {
        changeUsernameBtn.addEventListener('click', async () => {
            if (userDropdown) userDropdown.classList.remove('active');
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session?.user) return;

            const inputNovoUsuario = document.getElementById('novo-usuario');
            if (inputNovoUsuario) {
                const currentName = localStorage.getItem('concord_username') || session.user.user_metadata?.username || '';
                inputNovoUsuario.value = currentName;
            }

            const msgBox = document.getElementById('msg-alterar-usuario');
            if (msgBox) msgBox.style.display = 'none';

            window.abrirModal('modal-alterar-usuario');
        });
    }

    // Alterar Nome de Usuário — Submeter Formulário
    const formAlterarUsuario = document.getElementById('form-alterar-usuario');
    if (formAlterarUsuario) {
        formAlterarUsuario.addEventListener('submit', async (e) => {
            e.preventDefault();

            const inputNovoUsuario = document.getElementById('novo-usuario');
            const msgBox = document.getElementById('msg-alterar-usuario');
            const btnSalvar = document.getElementById('btn-salvar-usuario');

            if (!inputNovoUsuario || !msgBox) return;

            const trimmedName = inputNovoUsuario.value.trim();
            if (trimmedName.length < 2 || trimmedName.length > 32) {
                msgBox.style.display = 'block';
                msgBox.style.color = '#F43F5E';
                msgBox.textContent = 'O nome de usuário deve ter entre 2 e 32 caracteres.';
                return;
            }

            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session?.user) return;

            if (btnSalvar) {
                btnSalvar.disabled = true;
                btnSalvar.textContent = 'Verificando...';
            }

            try {
                // Verificar se o nome de usuário já está em uso por outra conta
                const { data: existingUser } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .ilike('username', trimmedName)
                    .neq('id', session.user.id)
                    .maybeSingle();

                if (existingUser) {
                    msgBox.style.display = 'block';
                    msgBox.style.color = '#F43F5E';
                    msgBox.textContent = 'Este nome de usuário já está em uso por outra conta. Escolha um diferente.';
                    if (btnSalvar) {
                        btnSalvar.disabled = false;
                        btnSalvar.textContent = 'Salvar Alteração';
                    }
                    return;
                }

                // Atualizar na tabela profiles
                const { error: profileErr } = await supabaseClient
                    .from('profiles')
                    .update({ username: trimmedName, updated_at: new Date().toISOString() })
                    .eq('id', session.user.id);

                if (profileErr) {
                    msgBox.style.display = 'block';
                    msgBox.style.color = '#F43F5E';
                    msgBox.textContent = 'Erro ao atualizar nome no perfil: ' + profileErr.message;
                    if (btnSalvar) {
                        btnSalvar.disabled = false;
                        btnSalvar.textContent = 'Salvar Alteração';
                    }
                    return;
                }

                // Atualizar no auth metadata
                await supabaseClient.auth.updateUser({
                    data: { username: trimmedName, display_name: trimmedName }
                });

                localStorage.setItem('concord_username', trimmedName);
                localStorage.setItem('concord_username_v1', trimmedName);

                msgBox.style.display = 'block';
                msgBox.style.color = '#10B981';
                msgBox.textContent = 'Nome de usuário alterado com sucesso!';

                // Atualizar elementos da nav sem precisar de reload
                const navUserName = document.getElementById('navUserName');
                const dropdownName = document.getElementById('dropdownName');
                if (navUserName) navUserName.textContent = trimmedName;
                if (dropdownName) dropdownName.textContent = trimmedName;

                setTimeout(() => {
                    window.fecharModal('modal-alterar-usuario');
                    if (btnSalvar) {
                        btnSalvar.disabled = false;
                        btnSalvar.textContent = 'Salvar Alteração';
                    }
                }, 1500);

            } catch (err) {
                console.error('Erro ao alterar usuário:', err);
                msgBox.style.display = 'block';
                msgBox.style.color = '#F43F5E';
                msgBox.textContent = 'Ocorreu um erro ao salvar a alteração.';
                if (btnSalvar) {
                    btnSalvar.disabled = false;
                    btnSalvar.textContent = 'Salvar Alteração';
                }
            }
        });
    }

    // Alterar Senha — Abrir Modal
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', async () => {
            if (userDropdown) userDropdown.classList.remove('active');
            const { data: { session } } = await supabaseClient.auth.getSession();

            const inputEmail = document.getElementById('email-confirmacao');
            if (inputEmail && session?.user?.email) {
                inputEmail.value = session.user.email;
            }

            const msgBox = document.getElementById('msg-alterar-senha');
            if (msgBox) msgBox.style.display = 'none';

            window.abrirModal('modal-alterar-senha');
        });
    }

    // Alterar Senha — Submeter Formulário
    const formAlterarSenha = document.getElementById('form-alterar-senha');
    if (formAlterarSenha) {
        formAlterarSenha.addEventListener('submit', async (e) => {
            e.preventDefault();

            const inputEmail = document.getElementById('email-confirmacao');
            const msgBox = document.getElementById('msg-alterar-senha');
            const btnEnviar = document.getElementById('btn-enviar-link-senha');

            if (!inputEmail || !msgBox) return;

            const emailVal = inputEmail.value.trim();
            if (!emailVal || !emailVal.includes('@')) {
                msgBox.style.display = 'block';
                msgBox.style.color = '#F43F5E';
                msgBox.textContent = 'Por favor, informe um e-mail válido.';
                return;
            }

            if (btnEnviar) {
                btnEnviar.disabled = true;
                btnEnviar.textContent = 'Enviando...';
            }

            try {
                const { error } = await supabaseClient.auth.resetPasswordForEmail(emailVal, {
                    redirectTo: window.location.origin + '/reset-password.html'
                });

                if (error) {
                    msgBox.style.display = 'block';
                    msgBox.style.color = '#F43F5E';
                    msgBox.textContent = 'Erro ao enviar e-mail: ' + error.message;
                } else {
                    msgBox.style.display = 'block';
                    msgBox.style.color = '#10B981';
                    msgBox.textContent = 'E-mail de redefinição enviado com sucesso! Verifique sua caixa de entrada.';
                    setTimeout(() => {
                        window.fecharModal('modal-alterar-senha');
                    }, 2500);
                }
            } catch (err) {
                console.error('Erro ao enviar reset de senha:', err);
                msgBox.style.display = 'block';
                msgBox.style.color = '#F43F5E';
                msgBox.textContent = 'Erro ao solicitar redefinição de senha.';
            } finally {
                if (btnEnviar) {
                    btnEnviar.disabled = false;
                    btnEnviar.textContent = 'Enviar Link';
                }
            }
        });
    }

    // Logout
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabaseClient.auth.signOut();
            updateNavForUser(null);
            userDropdown.classList.remove('active');
        });
    }

    // Check session on load
    async function initAuth() {
        if (typeof supabaseClient === 'undefined') return;
        
        const { data: { session } } = await supabaseClient.auth.getSession();
        updateNavForUser(session?.user || null);

        // Listen for auth state changes
        supabaseClient.auth.onAuthStateChange((event, session) => {
            updateNavForUser(session?.user || null);
        });
    }

    initAuth();

});

