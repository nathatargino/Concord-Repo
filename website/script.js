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

    // ---- Intersection Observer for Animations ----
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = entry.target.getAttribute('data-aos-delay') || 0;
                setTimeout(() => {
                    entry.target.classList.add('aos-animate');
                }, delay);
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('[data-aos]').forEach(el => {
        observer.observe(el);
    });

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

    async function updateNavForUser(user) {
        if (!navAuth || !navUser) return;

        if (user) {
            const meta = user.user_metadata || {};
            let displayName = localStorage.getItem('concord_username') || meta.display_name || meta.full_name || meta.username || user.email.split('@')[0];
            let avatarUrl = meta.avatar_url;

            // Update nav with initial known values
            navAuth.style.display = 'none';
            navUser.style.display = 'flex';
            navUserName.textContent = displayName;

            if (avatarUrl) {
                navUserAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                if (dropdownAvatar) dropdownAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                navUserAvatar.textContent = getInitials(displayName);
                if (dropdownAvatar) dropdownAvatar.textContent = getInitials(displayName);
            }

            if (dropdownName) dropdownName.textContent = displayName;
            if (dropdownEmail) dropdownEmail.textContent = user.email;

            // Fetch latest profile from Supabase profiles table
            try {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('username, avatar_url')
                    .eq('id', user.id)
                    .maybeSingle();

                if (profile?.username && profile.username !== displayName) {
                    displayName = profile.username;
                    navUserName.textContent = displayName;
                    if (dropdownName) dropdownName.textContent = displayName;
                    if (!profile.avatar_url) {
                        navUserAvatar.textContent = getInitials(displayName);
                        if (dropdownAvatar) dropdownAvatar.textContent = getInitials(displayName);
                    }
                }
            } catch (err) {
                // Ignore silent fetch error
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

