import React, { useState, useEffect, useRef } from 'react';
import styles from './LoginModal.module.css';
import { supabase, syncProfileAfterAuth } from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import toast from 'react-hot-toast';

interface Props {
  onLogin: (name: string) => void;
  initialError?: string;
  onClose?: () => void;
  initialMode?: 'login' | 'register' | 'anonymous';
}

export const LoginModal: React.FC<Props> = ({ onLogin, initialError, onClose, initialMode }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'anonymous'>(initialMode || 'anonymous');

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // States
  const [error, setError] = useState(initialError || '');
  const [loading, setLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  // Carregar dados salvos
  useEffect(() => {
    const savedEmail = localStorage.getItem('concord_saved_email');
    if (savedEmail) setEmail(savedEmail);

    const syncSession = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          if (user.email) setEmail(user.email);
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .maybeSingle();

          const avatar = profile?.avatar_url || user.user_metadata?.avatar_url;
          if (avatar) {
            localStorage.setItem('concord_avatar_url', avatar);
            useAppStore.getState().setMyAvatarUrl(avatar);
          }

          const name = profile?.username || user.user_metadata?.username || user.user_metadata?.display_name || user.email?.split('@')[0];
          if (name) {
            setUsername(name);
            // Se NÃO estiver abrindo explicitamente para login/conversão de conta, auto-loga
            if (initialMode !== 'login') {
              localStorage.setItem('concord_username', name);
              localStorage.setItem('concord_username_v1', name);
              savePrefsToElectron({ concord_username: name, concord_avatar_url: avatar || '' });
              onLogin(name);
              return;
            }
          }
        }

        // Tentar carregar do Electron ou localStorage
        const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
        if (isElectron && (window as any).electron?.loadPreferences) {
          const prefs = await (window as any).electron.loadPreferences();
          if (prefs?.concord_username) {
            localStorage.setItem('concord_username', prefs.concord_username);
            if (prefs.concord_pid) localStorage.setItem('concord_pid', prefs.concord_pid);
            if (prefs.concord_avatar_url) localStorage.setItem('concord_avatar_url', prefs.concord_avatar_url);
            if (initialMode !== 'login') {
              onLogin(prefs.concord_username);
              return;
            }
          }
        }

        const savedUsername = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
        if (savedUsername) setUsername(savedUsername);
      } catch (err) {
        console.debug('Session check note:', err);
      }
    };

    syncSession();
  }, [initialMode, onLogin]);

  // Escutar eventos de login com Google / OAuth
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) {
        setIsGoogleLoading(false);
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }

        const { username: finalName } = await syncProfileAfterAuth(session.user);
        toast.success(`Conectado com sucesso como ${finalName}!`);
        onLogin(finalName);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [onLogin]);

  // Fechar ao apertar Escape
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (isGoogleLoading) {
          cancelGoogleAuth();
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, isGoogleLoading]);

  // Helper: salva preferências no Electron e no localStorage
  function savePrefsToElectron(prefs: Record<string, string>) {
    for (const [key, value] of Object.entries(prefs)) {
      localStorage.setItem(key, value);
    }
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    if (isElectron && (window as any).electron?.savePreferences) {
      (window as any).electron.savePreferences(prefs);
    }
  }

  const cancelGoogleAuth = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    if (isElectron && (window as any).electron?.cancelGoogleAuth) {
      (window as any).electron.cancelGoogleAuth();
    }
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.close();
      } catch {}
    }
    setIsGoogleLoading(false);
    toast('Login com Google cancelado.', { icon: 'ℹ️' });
  };

  const handleGoogleAuth = async () => {
    try {
      setError('');
      setIsGoogleLoading(true);

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const redirectUrl = isElectron 
        ? 'http://127.0.0.1:54321/callback' 
        : window.location.origin;

      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (authError) throw authError;

      if (!data?.url) {
        throw new Error('Não foi possível obter a URL do Google.');
      }

      if (isElectron && (window as any).electron?.openGoogleAuth) {
        await (window as any).electron.openGoogleAuth(data.url);
        // Inicia polling de sessão como garantia enquanto aguarda no navegador padrão
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setInterval(async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
              setIsGoogleLoading(false);
              const { username: finalName, avatarUrl: finalAvatar } = await syncProfileAfterAuth(session.user);
              if (finalName) {
                localStorage.setItem('concord_username', finalName);
                localStorage.setItem('concord_username_v1', finalName);
                savePrefsToElectron({ concord_username: finalName, concord_avatar_url: finalAvatar || '' });
                toast.success(`Conectado com sucesso como ${finalName}!`);
                onLogin(finalName);
              }
            }
          } catch {}
        }, 1000);
      } else {
        // Abre janela/aba externa pequena centralizada no navegador
        const width = 500;
        const height = 650;
        const left = Math.max(0, Math.round(window.screen.width / 2 - width / 2));
        const top = Math.max(0, Math.round(window.screen.height / 2 - height / 2));
        const popup = window.open(
          data.url,
          'concord_google_auth',
          `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
        );
        popupRef.current = popup;

        // Monitora se o usuário fechou o popup ou se a sessão foi concluída
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setInterval(async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
              setIsGoogleLoading(false);
              if (popup && !popup.closed) {
                try { popup.close(); } catch {}
              }
              const { username: finalName, avatarUrl: finalAvatar } = await syncProfileAfterAuth(session.user);
              if (finalName) {
                localStorage.setItem('concord_username', finalName);
                localStorage.setItem('concord_username_v1', finalName);
                savePrefsToElectron({ concord_username: finalName, concord_avatar_url: finalAvatar || '' });
                toast.success(`Conectado com sucesso como ${finalName}!`);
                onLogin(finalName);
              }
              return;
            }
            if (popup && popup.closed) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
              setIsGoogleLoading(false);
            }
          } catch {}
        }, 1000);
      }
    } catch (err: any) {
      console.error('Google Auth error:', err);
      setIsGoogleLoading(false);
      setError(err.message || 'Erro ao conectar com Google.');
      toast.error('Não foi possível conectar com o Google.');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (rememberMe && email) {
        localStorage.setItem('concord_saved_email', email);
      } else {
        localStorage.removeItem('concord_saved_email');
      }

      if (email && password) {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (authError) {
          if (authError.message.includes('Invalid login credentials')) {
            setError('E-mail ou senha incorretos.');
          } else {
            setError(authError.message);
          }
          setLoading(false);
          return;
        }

        if (data.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', data.user.id)
            .maybeSingle();

          const avatar = profile?.avatar_url || data.user.user_metadata?.avatar_url;
          if (avatar) {
            localStorage.setItem('concord_avatar_url', avatar);
            useAppStore.getState().setMyAvatarUrl(avatar);
          }

          const displayName = profile?.username || data.user.user_metadata?.username || username || data.user.email?.split('@')[0] || 'Usuário';
          localStorage.setItem('concord_username', displayName);
          localStorage.setItem('concord_username_v1', displayName);
          savePrefsToElectron({ concord_username: displayName, concord_avatar_url: avatar || '' });
          toast.success(`Bem-vindo de volta, ${displayName}!`);
          onLogin(displayName);
          return;
        }
      }

      const fallbackName = username.trim() || email.split('@')[0] || 'Usuário';
      localStorage.setItem('concord_username', fallbackName);
      savePrefsToElectron({ concord_username: fallbackName });
      onLogin(fallbackName);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Erro ao efetuar login.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Por favor, informe um nome de usuário.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Por favor, informe um e-mail válido.');
      return;
    }
    if (!password || password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const cleanUsername = username.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: { username: cleanUsername },
        },
      });

      if (signUpError) throw signUpError;

      if (data.user) {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          username: cleanUsername,
          updated_at: new Date().toISOString(),
        });
      }

      localStorage.setItem('concord_username', cleanUsername);
      localStorage.setItem('concord_username_v1', cleanUsername);
      savePrefsToElectron({ concord_username: cleanUsername });
      toast.success('Conta criada com sucesso! Conectando...');
      onLogin(cleanUsername);
    } catch (err: any) {
      console.error('Register error:', err);
      setError(err.message || 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.abrirModal) {
      window.abrirModal('modal-alterar-senha');
    } else {
      toast('Utilize a opção de redefinir senha no menu de conta.', { icon: '🔑' });
    }
  };

  return (
    <div 
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            <div className={styles.modalHeaderIcon}>
              <i className={`fa-solid ${mode === 'login' ? 'fa-user-lock' : mode === 'register' ? 'fa-user-plus' : 'fa-ghost'}`} />
            </div>
            <div className={styles.modalHeaderTitles}>
              <h3 className={styles.modalTitle}>
                {mode === 'login' ? 'Acesse sua conta' : mode === 'register' ? 'Criar Conta' : 'Entrar como Convidado'}
              </h3>
              <p className={styles.modalSubtitle}>
                {mode === 'login' 
                  ? 'Entre para salvar seus servidores e perfil.' 
                  : mode === 'register' 
                  ? 'Preencha seus dados para se cadastrar.' 
                  : 'Sem cadastro • Sem senha • Apenas um apelido'}
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              title="Fechar"
              aria-label="Fechar modal"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>

        {error && (
          <div className={styles.errorBox}>
            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '13px' }} />
            <span>{error}</span>
          </div>
        )}

        {mode === 'login' && (
          <>
            <form className={styles.form} onSubmit={handleLoginSubmit}>
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="login-email">E-mail</label>
                <input
                  type="email"
                  id="login-email"
                  className={styles.input}
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || isGoogleLoading}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="login-senha">Senha</label>
                <input
                  type="password"
                  id="login-senha"
                  className={styles.input}
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || isGoogleLoading}
                  required
                />
              </div>

              <div className={styles.optionsRow}>
                <label className={styles.rememberLabel}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading || isGoogleLoading}
                  />
                  <span>Salvar credenciais</span>
                </label>
                <a href="#" onClick={handleForgotPassword} className={styles.forgotLink}>
                  Esqueceu sua senha?
                </a>
              </div>

              <button 
                type="submit" 
                className={styles.primaryBtn} 
                disabled={loading || isGoogleLoading}
              >
                {loading ? <span className={styles.spinner} /> : <i className="fa-solid fa-arrow-right-to-bracket" />}
                <span>{loading ? 'Entrando...' : 'Entrar'}</span>
              </button>

              <div className={styles.divider}>
                <span>ou continue com</span>
              </div>

              <button 
                type="button" 
                className={`${styles.googleBtn} ${isGoogleLoading ? styles.googleBtnLoading : ''}`} 
                onClick={handleGoogleAuth}
                disabled={loading || isGoogleLoading}
                title={isGoogleLoading ? 'Aguardando login no Google...' : 'Entrar com Google'}
              >
                {isGoogleLoading ? (
                  <>
                    <span className={styles.spinner} />
                    <span>Conectando com o Google...</span>
                  </>
                ) : (
                  <>
                    <svg className={styles.googleIcon} viewBox="0 0 24 24" width="18" height="18">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Entrar com Google</span>
                  </>
                )}
              </button>

              {isGoogleLoading && (
                <button
                  type="button"
                  className={styles.cancelGoogleBtn}
                  onClick={cancelGoogleAuth}
                >
                  <i className="fa-solid fa-xmark" />
                  <span>Cancelar login com Google</span>
                </button>
              )}

              <button 
                type="button" 
                className={styles.secondaryBtn} 
                onClick={() => { setError(''); setMode('anonymous'); }}
                disabled={isGoogleLoading || loading}
                title={isGoogleLoading ? 'Aguardando conclusão do login com Google...' : 'Entrar sem conta fixa'}
              >
                <i className="fa-solid fa-user-secret" />
                <span>Entrar como Anônimo</span>
              </button>
            </form>

            <div className={styles.cardFooter}>
              <span>Não tem uma conta?</span>
              <span
                className={styles.switchLink}
                onClick={() => {
                  if (isGoogleLoading) return;
                  setError('');
                  setMode('register');
                }}
              >
                Criar Conta
              </span>
            </div>
          </>
        )}

        {mode === 'register' && (
          <>
            <form className={styles.form} onSubmit={handleRegisterSubmit}>
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="reg-usuario">Nome de usuário</label>
                <input
                  type="text"
                  id="reg-usuario"
                  className={styles.input}
                  placeholder="Seu apelido ou nome"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading || isGoogleLoading}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="reg-email">E-mail</label>
                <input
                  type="email"
                  id="reg-email"
                  className={styles.input}
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || isGoogleLoading}
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="reg-senha">Senha</label>
                <input
                  type="password"
                  id="reg-senha"
                  className={styles.input}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || isGoogleLoading}
                  required
                />
              </div>

              <button 
                type="submit" 
                className={styles.primaryBtn} 
                disabled={loading || isGoogleLoading}
              >
                {loading ? <span className={styles.spinner} /> : <i className="fa-solid fa-user-check" />}
                <span>{loading ? 'Criando Conta...' : 'Criar Conta'}</span>
              </button>

              <div className={styles.divider}>
                <span>ou continue com</span>
              </div>

              <button 
                type="button" 
                className={`${styles.googleBtn} ${isGoogleLoading ? styles.googleBtnLoading : ''}`} 
                onClick={handleGoogleAuth}
                disabled={loading || isGoogleLoading}
              >
                {isGoogleLoading ? (
                  <>
                    <span className={styles.spinner} />
                    <span>Conectando com o Google...</span>
                  </>
                ) : (
                  <>
                    <svg className={styles.googleIcon} viewBox="0 0 24 24" width="18" height="18">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Continuar com Google</span>
                  </>
                )}
              </button>

              {isGoogleLoading && (
                <button
                  type="button"
                  className={styles.cancelGoogleBtn}
                  onClick={cancelGoogleAuth}
                >
                  <i className="fa-solid fa-xmark" />
                  <span>Cancelar login com Google</span>
                </button>
              )}
            </form>

            <div className={styles.cardFooter}>
              <span>Já tem uma conta?</span>
              <span
                className={styles.switchLink}
                onClick={() => {
                  if (isGoogleLoading) return;
                  setError('');
                  setMode('login');
                }}
              >
                Entrar
              </span>
            </div>
          </>
        )}

        {mode === 'anonymous' && (
          <>
            <form 
              className={styles.form} 
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                if (!username.trim()) {
                  setError('Por favor, informe um apelido.');
                  return;
                }
                const cleanUsername = username.trim();
                localStorage.setItem('concord_username', cleanUsername);
                localStorage.setItem('concord_username_v1', cleanUsername);
                savePrefsToElectron({ concord_username: cleanUsername });
                toast.success(`Bem-vindo, ${cleanUsername}!`);
                onLogin(cleanUsername);
              }}
            >
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="anon-usuario">Como você quer ser chamado?</label>
                <input
                  type="text"
                  id="anon-usuario"
                  className={styles.input}
                  placeholder="Digite seu apelido..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <button type="submit" className={styles.primaryBtn}>
                <span>Entrar no Concord →</span>
              </button>

              <div className={styles.divider}>
                <span>ou</span>
              </div>

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => { setError(''); setMode('login'); }}
              >
                <i className="fa-solid fa-arrow-right-to-bracket" />
                <span>Logar com conta permanente</span>
              </button>
            </form>

            <div className={styles.cardFooter}>
              <span>Sem cadastro • Sem senha • Apenas uma conversa</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
