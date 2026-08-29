/* ================================================
   CONCORD — JavaScript
   Theme Toggle, Auth Tabs, Mobile Menu, Animations
   ================================================ */

window.abrirModal = function(idModal) {
    const modal = document.getElementById(idModal);
    if (modal) {
        modal.style.setProperty('display', 'flex', 'important');
        modal.classList.add('active');
    }
};

window.fecharModal = function(idModal) {
    const modal = document.getElementById(idModal);
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
        const msgEl = modal.querySelector('[id^="msg-alterar-"]');
        if (msgEl) msgEl.style.display = 'none';
    }
};

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
            const localSavedAvatar = localStorage.getItem('concord_avatar_url');
            let displayName = meta.display_name || meta.full_name || meta.username || user.email.split('@')[0];
            let avatarUrl = meta.avatar_url || localSavedAvatar || null;

            // Update nav immediately
            navAuth.style.display = 'none';
            navUser.style.display = 'flex';
            navUserName.textContent = displayName;

            function renderAvatar(url, name) {
                const initials = getInitials(name);
                if (url) {
                    navUserAvatar.innerHTML = `<img src="${url}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`;
                    if (dropdownAvatar) dropdownAvatar.innerHTML = `<img src="${url}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`;
                } else {
                    navUserAvatar.textContent = initials;
                    if (dropdownAvatar) dropdownAvatar.textContent = initials;
                }
            }

            renderAvatar(avatarUrl, displayName);

            if (dropdownName) dropdownName.textContent = displayName;
            if (dropdownEmail) dropdownEmail.textContent = user.email;

            // Asynchronously fetch latest profile from Supabase profiles table
            if (typeof supabaseClient !== 'undefined' && user) {
                const criteria = [];
                if (user.id) criteria.push(`id.eq.${user.id}`);
                if (user.email) criteria.push(`email.eq.${user.email}`);
                if (displayName) criteria.push(`username.ilike.${displayName}`);

                supabaseClient
                    .from('profiles')
                    .select('username, avatar_url')
                    .or(criteria.join(','))
                    .maybeSingle()
                    .then(({ data: profileData }) => {
                        if (profileData) {
                            if (profileData.username) {
                                displayName = profileData.username;
                                navUserName.textContent = displayName;
                                if (dropdownName) dropdownName.textContent = displayName;
                            }
                            if (profileData.avatar_url) {
                                avatarUrl = profileData.avatar_url;
                                localStorage.setItem('concord_avatar_url', avatarUrl);
                            }
                            renderAvatar(avatarUrl, displayName);
                        }
                    })
                    .catch(err => console.warn('Fetch profile for nav warning:', err));
            }

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

    // Modais e Funções Globais (Instantâneos e Síncronos)
    window.abrirModal = function(idModal) {
        const modal = document.getElementById(idModal);
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
        }
    };

    window.fecharModal = function(idModal) {
        const modal = document.getElementById(idModal);
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
            const msgEl = modal.querySelector('[id^="msg-alterar-"]');
            if (msgEl) msgEl.style.display = 'none';
        }
    };

    window.addEventListener('click', (event) => {
        if (event.target && event.target.classList && event.target.classList.contains('modal-concord')) {
            window.fecharModal(event.target.id);
        }
    });

    // Alterar Senha — Redirecionar para Tela de Perfil
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            if (userDropdown) userDropdown.classList.remove('active');
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

