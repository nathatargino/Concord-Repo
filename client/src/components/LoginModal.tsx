import React, { useState, useEffect, useRef } from 'react';
import styles from './LoginModal.module.css';
import { supabase } from '../lib/supabase';

interface Props {
  onLogin: (name: string) => void;
  initialError?: string;
}

export const LoginModal: React.FC<Props> = ({ onLogin, initialError }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState(initialError || '');
  const [visible, setVisible] = useState(false);
  const [sessionData, setSessionData] = useState<{access_token: string, refresh_token: string} | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);
    setTimeout(() => inputRef.current?.focus(), 200);

    const syncAccountName = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          setSessionData({ access_token: session.access_token, refresh_token: session.refresh_token });
        }

        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .maybeSingle();

          const accountName = profile?.username || user.user_metadata?.username || user.user_metadata?.display_name || user.email?.split('@')[0];
          if (accountName && accountName.trim()) {
            const cleanName = accountName.trim();
            setName(cleanName);
            localStorage.setItem('concord_username', cleanName);
            localStorage.setItem('concord_username_v1', cleanName);
            return;
          }
        }
      } catch (err) {
        console.warn('Supabase auth session check warning:', err);
      }

      const savedName = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
      if (savedName && savedName.trim()) {
        setName(savedName.trim());
      }
    };

    syncAccountName();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('Nome deve ter pelo menos 2 caracteres');
      return;
    }
    if (trimmed.length > 32) {
      setError('Nome muito longo (máximo 32 caracteres)');
      return;
    }
    localStorage.setItem('concord_username', trimmed);
    onLogin(trimmed);
  };

  return (
    <div className={`${styles.overlay} ${visible ? styles.visible : ''}`}>
      <div className={`${styles.modal} ${visible ? styles.modalVisible : ''}`}>
        <div className={styles.logoArea}>
          <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
          <h1 className={styles.logoText}>Concord</h1>
          <p className={styles.tagline}>Música e voz em tempo real</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="login-name">
              Como você quer ser chamado?
            </label>
            <input
              ref={inputRef}
              id="login-name"
              type="text"
              className={styles.input}
              placeholder="Digite seu apelido..."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit(e as unknown as React.FormEvent);
              }}
              maxLength={32}
              autoComplete="off"
            />
            {error && <span className={styles.error}>{error}</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button type="submit" className={styles.btn} disabled={!name.trim()}>
              <span>Entrar no Concord</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
            
            {sessionData && !(window as any).electron && (
              <a 
                href={`concord://auth?access_token=${sessionData.access_token}&refresh_token=${sessionData.refresh_token}`}
                className={styles.btnSecondary}
                onClick={() => {
                  setTimeout(() => {
                    onLogin(name.trim() || 'Usuário');
                  }, 1500);
                }}
              >
                <span>Abrir no App Desktop</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </a>
            )}
          </div>
        </form>

        <p className={styles.footer}>
          Sem cadastro • Sem senha • Apenas uma conversa
        </p>
      </div>
    </div>
  );
};
