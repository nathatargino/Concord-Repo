import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import styles from './StatusBar.module.css';

function formatTimeLeft(ms: number): { text: string; isWarning: boolean; isCritical: boolean } {
  if (ms <= 0) return { text: 'Expirada', isWarning: true, isCritical: true };
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return {
    text,
    isWarning: ms < 30 * 60 * 1000, // < 30 min
    isCritical: ms < 5 * 60 * 1000, // < 5 min
  };
}

export const StatusBar: React.FC = () => {
  const { connected, myName, room } = useAppStore();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState<ReturnType<typeof formatTimeLeft> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!room) {
      setTimeLeft(null);
      return;
    }

    const update = () => {
      const ms = room.expiresAt - Date.now();
      setTimeLeft(formatTimeLeft(ms));
      if (ms <= 0) {
        // Room expired
        useAppStore.getState().setRoom(null);
        navigate('/');
      }
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [room, navigate]);

  const handleCopyInvite = useCallback(() => {
    if (!room) return;
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    const baseUrl = isElectron 
      ? 'https://concord-repo.onrender.com' 
      : window.location.origin;
    const url = `${baseUrl}/#/room/${room.id}?code=${room.code}`;
    try {
      if ((window as any).electron?.copyToClipboard) {
        (window as any).electron.copyToClipboard(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }, [room]);

  const handleLeaveRoom = useCallback(() => {
    useAppStore.getState().setRoom(null);
    navigate('/');
  }, [navigate]);

  return (
    <footer className={styles.footer}>
      {/* Left: connection status */}
      <div className={styles.left}>
        <div className={`${styles.statusDot} ${connected ? styles.connected : styles.disconnected}`} />
        <span className={styles.statusText}>
          {connected ? 'Conectado' : 'Desconectado'}
        </span>
        {myName && (
          <span className={styles.userName}>{myName}</span>
        )}
      </div>

      {/* Center: room timer */}
      {room && timeLeft && (
        <div className={styles.center}>
          <span className={styles.roomCode}>
            <span className={styles.codeLabel}>Sala</span>
            <span className={styles.codeValue}>{room.code}</span>
          </span>
          <span className={styles.timerSep}>•</span>
          <div
            className={`${styles.timer} ${timeLeft.isWarning ? styles.timerWarning : ''} ${timeLeft.isCritical ? styles.timerCritical : ''}`}
            title="Tempo restante da sala"
          >
            <span className={styles.timerIcon}>⏱</span>
            <span className={styles.timerText}>{timeLeft.text}</span>
          </div>
        </div>
      )}

      {/* Right: invite + user */}
      <div className={styles.right}>
        {room && (
          <>
            <button
              className={`${styles.inviteBtn} ${copied ? styles.inviteCopied : ''}`}
              onClick={handleCopyInvite}
              title="Copiar link de convite"
            >
              {copied ? '✓ Copiado!' : '🔗 Convidar'}
            </button>
            <button
              className={styles.leaveBtn}
              onClick={handleLeaveRoom}
              title="Sair da sala"
            >
              ⍈ Sair
            </button>
          </>
        )}
        {!room && myName && (
          <span className={styles.userText}>
            Logado como <strong className={styles.userNameRight}>{myName}</strong>
          </span>
        )}
      </div>
    </footer>
  );
};
