import React, { useState, useEffect } from 'react';
import styles from './LoginModal.module.css';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import toast from 'react-hot-toast';

interface Props {
  onLogin: (name: string) => void;
  initialError?: string;
}

export const LoginModal: React.FC<Props> = ({ onLogin, initialError }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // States
  const [error, setError] = useState(initialError || '');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);

    // Carregar e-mail ou nome salvo se 'Salvar credenciais' estava ativo
    const savedEmail = localStorage.getItem('concord_saved_email');
    if (savedEmail) setEmail(savedEmail);

    const savedUsername = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
    if (savedUsername) setUsername(savedUsername);

    // Sync account name and avatar from active Supabase session if logged in
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
            onLogin(name);
          }
        }
      } catch (err) {
        console.debug('Session check note:', err);
      }
    };

    syncSession();
  }, [onLogin]);

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

      // Tentar Login no Supabase Auth
      if (email && password) {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (authError) {
          // Exibir mensagem clara de erro de login
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
          toast.success(`Bem-vindo de volta, ${displayName}!`);
          onLogin(displayName);
          return;
        }
      }

      // Fallback para login direto com apelido ou email
      const fallbackName = username.trim() || email.split('@')[0] || 'Usuário';
      localStorage.setItem('concord_username', fallbackName);
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
        // Criar ou atualizar perfil na tabela 'profiles'
        await supabase.from('profiles').upsert({
          id: data.user.id,
          username: cleanUsername,
          updated_at: new Date().toISOString(),
        });
      }

      localStorage.setItem('concord_username', cleanUsername);
      toast.success('Conta criada com sucesso! Conectando...');
      onLogin(cleanUsername);
    } catch (err: any) {
      console.error('Register error:', err);
      setError(err.message || 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      console.error('Google Auth error:', err);
      toast.error('Não foi possível conectar com o Google.');
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
    <div className={`${styles.overlay} ${visible ? styles.visible : ''}`}>
      <div className="auth-container">
        <div className="auth-card">
          {mode === 'login' ? (
            /* HTML 1: TELA DE LOGIN */
            <>
              <div className="auth-cabecalho">
                <h2>Acesse sua conta</h2>
                <p>Entre para continuar conectado com seus amigos.</p>
              </div>

              <form className="auth-form" onSubmit={handleLoginSubmit}>
                {error && (
                  <div style={{ color: '#F43F5E', fontSize: '0.85rem', marginBottom: '15px' }}>
                    ⚠️ {error}
                  </div>
                )}

                <div className="input-grupo">
                  <label htmlFor="login-email">E-mail</label>
                  <input
                    type="email"
                    id="login-email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="input-grupo">
                  <label htmlFor="login-senha">Senha</label>
                  <input
                    type="password"
                    id="login-senha"
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="auth-opcoes">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                    Salvar credenciais
                  </label>
                  <a href="#" onClick={handleForgotPassword} className="link-neon">
                    Esqueceu sua senha?
                  </a>
                </div>

                <button type="submit" className="botao-neon" disabled={loading}>
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>

                <div className="divisor">
                  <span>ou continue com</span>
                </div>

                <button type="button" className="botao-secundario" onClick={handleGoogleAuth}>
                  <svg className="icone-btn" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  Entrar com Google
                </button>
              </form>

              <p className="auth-rodape">
                Não tem uma conta?{' '}
                <span
                  className="link-neon"
                  onClick={() => {
                    setError('');
                    setMode('register');
                  }}
                >
                  Criar Conta
                </span>
              </p>
            </>
          ) : (
            /* HTML 2: TELA DE CRIAR CONTA (CADASTRO) */
            <>
              <div className="auth-cabecalho">
                <h2>Criar Conta</h2>
                <p>Preencha os dados para se cadastrar.</p>
              </div>

              <form className="auth-form" onSubmit={handleRegisterSubmit}>
                {error && (
                  <div style={{ color: '#F43F5E', fontSize: '0.85rem', marginBottom: '15px' }}>
                    ⚠️ {error}
                  </div>
                )}

                <div className="input-grupo">
                  <label htmlFor="reg-usuario">Nome de usuário</label>
                  <input
                    type="text"
                    id="reg-usuario"
                    placeholder="Seu nome de usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="input-grupo">
                  <label htmlFor="reg-email">E-mail</label>
                  <input
                    type="email"
                    id="reg-email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="input-grupo">
                  <label htmlFor="reg-senha">Crie uma senha forte</label>
                  <input
                    type="password"
                    id="reg-senha"
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="botao-neon" disabled={loading}>
                  {loading ? 'Criando Conta...' : 'Criar Conta'}
                </button>

                <div className="divisor">
                  <span>ou continue com</span>
                </div>

                <button type="button" className="botao-secundario" onClick={handleGoogleAuth}>
                  <svg className="icone-btn" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  Continuar com Google
                </button>
              </form>

              <p className="auth-rodape">
                Já tem uma conta?{' '}
                <span
                  className="link-neon"
                  onClick={() => {
                    setError('');
                    setMode('login');
                  }}
                >
                  Entrar
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
