import React, { useState, useEffect, useRef } from 'react';
import styles from './LoginModal.module.css';
import { supabase } from '../lib/supabase';

interface Props {
  onLogin: (name: string) => void;
}

export const LoginModal: React.FC<Props> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);
    setTimeout(() => inputRef.current?.focus(), 200);

    const savedName = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
    if (savedName && savedName.trim()) {
      setName(savedName.trim());
    } else {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          const defaultName = user.user_metadata?.username || user.user_metadata?.display_name || user.email?.split('@')[0];
          if (defaultName) {
            setName(defaultName);
            localStorage.setItem('concord_username', defaultName);
          }
        }
      }).catch((err) => console.warn('Supabase auth session check warning:', err));
    }
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

          <button type="submit" className={styles.btn} disabled={!name.trim()}>
            <span>Entrar no Concord</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>

        <p className={styles.footer}>
          Sem cadastro • Sem senha • Apenas uma conversa
        </p>
      </div>
    </div>
  );
};
