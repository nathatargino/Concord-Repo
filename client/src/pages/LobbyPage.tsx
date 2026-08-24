import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './LobbyPage.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

type Tab = 'home' | 'create' | 'join';

export const LobbyPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('home');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);

    // Auto-detect invite link: ?room=CODE or #CODE in URL
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      setCode(roomCode.toUpperCase());
      setTab('join');
    }
  }, []);

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao criar sala');
      const room = await res.json();
      const inviteUrl = `${window.location.origin}/room/${room.id}?code=${room.code}`;
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }
      navigate(`/room/${room.id}?code=${room.code}`);
    } catch (e) {
      setError('Não foi possível criar a sala. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Digite o código da sala');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/api/rooms/${trimmed}`);
      if (!res.ok) {
        setError('Sala não encontrada ou expirada. Verifique o código.');
        return;
      }
      const room = await res.json();
      navigate(`/room/${room.id}?code=${room.code}`);
    } catch (e) {
      setError('Erro ao verificar a sala. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${styles.page} ${visible ? styles.visible : ''}`}>
      {/* Background blobs */}
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.blob3} />

      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoArea}>
          <div className={styles.logoIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M9 18V5l12-2v13" stroke="url(#g1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="6" cy="18" r="3" stroke="url(#g1)" strokeWidth="1.5"/>
              <circle cx="18" cy="16" r="3" stroke="url(#g1)" strokeWidth="1.5"/>
              <defs>
                <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7C3AED"/>
                  <stop offset="100%" stopColor="#06B6D4"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className={styles.logoText}>Concord</h1>
          <p className={styles.tagline}>Música e voz em tempo real</p>
        </div>

        {/* Home tab */}
        {tab === 'home' && (
          <div className={styles.homeActions}>
            <button className={styles.primaryBtn} onClick={() => setTab('create')}>
              <span className={styles.btnIcon}>✨</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Criar Sala</span>
                <span className={styles.btnSub}>Inicie uma nova conversa</span>
              </div>
              <span className={styles.btnArrow}>→</span>
            </button>

            <button className={styles.secondaryBtn} onClick={() => setTab('join')}>
              <span className={styles.btnIcon}>🚀</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Entrar em uma Sala</span>
                <span className={styles.btnSub}>Use um código de convite</span>
              </div>
              <span className={styles.btnArrow}>→</span>
            </button>
          </div>
        )}

        {/* Create tab */}
        {tab === 'create' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('home'); setError(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>✨</div>
              <h2 className={styles.panelTitle}>Criar Nova Sala</h2>
              <p className={styles.panelDesc}>
                Uma sala com duração de 14 horas será criada. Você poderá convidar pessoas compartilhando o código.
              </p>
            </div>
            {error && <div className={styles.errorBox}>{error}</div>}
            <button
              className={styles.actionBtn}
              onClick={handleCreate}
              disabled={loading}
            >
              {loading ? <span className={styles.spinner} /> : '✨ Criar Sala Agora'}
            </button>
          </div>
        )}

        {/* Join tab */}
        {tab === 'join' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('home'); setError(''); setCode(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🚀</div>
              <h2 className={styles.panelTitle}>Entrar em uma Sala</h2>
              <p className={styles.panelDesc}>
                Digite o código de 6 letras compartilhado pelo criador da sala.
              </p>
            </div>

            <div className={styles.codeInputWrapper}>
              <input
                className={styles.codeInput}
                type="text"
                placeholder="Ex: AB3CX7"
                value={code}
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
                autoFocus
              />
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button
              className={styles.actionBtn}
              onClick={handleJoin}
              disabled={loading || !code.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🚀 Entrar na Sala'}
            </button>
          </div>
        )}

        <p className={styles.footer}>
          Sem cadastro • Sem senha • Apenas uma conversa
        </p>
      </div>
    </div>
  );
};
