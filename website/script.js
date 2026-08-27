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

    // Alterar Nome de Usuário
    const changeUsernameBtn = document.getElementById('changeUsernameBtn');
    if (changeUsernameBtn) {
        changeUsernameBtn.addEventListener('click', async () => {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session?.user) return;

            const newUsername = prompt('Digite o seu novo Nome de Usuário:');
            if (!newUsername || !newUsername.trim()) return;

            const trimmedName = newUsername.trim();
            if (trimmedName.length < 2 || trimmedName.length > 32) {
                alert('O nome de usuário deve ter entre 2 e 32 caracteres.');
                return;
            }

            // Verificar se o nome de usuário já está em uso
            const { data: existingUser } = await supabaseClient
                .from('profiles')
                .select('id')
                .ilike('username', trimmedName)
                .neq('id', session.user.id)
                .maybeSingle();

            if (existingUser) {
                alert('Este nome de usuário já está em uso por outra conta. Escolha outro.');
                return;
            }

            // Atualizar na tabela profiles
            const { error: profileErr } = await supabaseClient
                .from('profiles')
                .update({ username: trimmedName, updated_at: new Date().toISOString() })
                .eq('id', session.user.id);

            if (profileErr) {
                alert('Erro ao atualizar nome no perfil: ' + profileErr.message);
                return;
            }

            // Atualizar no auth metadata
            await supabaseClient.auth.updateUser({
                data: { username: trimmedName, display_name: trimmedName }
            });

            localStorage.setItem('concord_username', trimmedName);
            alert('Nome de usuário alterado com sucesso para "' + trimmedName + '"!');
            window.location.reload();
        });
    }

    // Alterar Senha com confirmação por e-mail
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', async () => {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session?.user?.email) return;

            const confirmAction = confirm('Enviaremos um e-mail de redefinição de senha com um link de segurança para: ' + session.user.email + '.\n\nDeseja continuar?');
            if (!confirmAction) return;

            const { error } = await supabaseClient.auth.resetPasswordForEmail(session.user.email, {
                redirectTo: window.location.origin + '/login.html'
            });

            if (error) {
                alert('Erro ao enviar e-mail de redefinição: ' + error.message);
            } else {
                alert('E-mail enviado com sucesso! Verifique a sua caixa de entrada para redefinir a senha.');
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

