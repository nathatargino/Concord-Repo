import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifyInChat } from '../utils/systemMessage';
import { useAppStore } from '../stores/useAppStore';
import styles from './StatusBar.module.css';
import { leaveServerFromSupabase, removeMyServer } from '../lib/supabase';

function formatTimeLeft(ms: number): { text: string; isWarning: boolean; isCritical: boolean } {
  if (ms <= 0) return { text: 'Expirada', isWarning: true, isCritical: true };
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return {
    text,
    isWarning: ms < 30 * 60 * 1000,
    isCritical: ms < 5 * 60 * 1000,
  };
}

export const StatusBar: React.FC = () => {
  const { connected, myName, room, isServer } = useAppStore();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState<ReturnType<typeof formatTimeLeft> | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (!room || room.isServer || isServer || !isFinite(room.expiresAt)) {
      setTimeLeft(null);
      return;
    }

    const update = () => {
      const ms = room.expiresAt - Date.now();
      setTimeLeft(formatTimeLeft(ms));
      if (ms <= 0) {
        useAppStore.getState().setRoom(null);
        navigate('/');
      }
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [room, isServer, navigate]);

  const handleCopyInvite = useCallback(() => {
    if (!room) return;
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    const baseUrl = isElectron 
      ? 'https://concord-olive.vercel.app' 
      : window.location.origin;
    const inviteMessage = `Você foi convidado para ${(room.isServer || isServer) ? 'um servidor' : 'uma sala'} no Concord! Acesse o link abaixo para entrar:\n${baseUrl}\nCódigo de convite: ${room.code}`;
    
    const copyAndNotify = (text: string, label: string) => {
      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          notifyInChat(label);
        } else {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            notifyInChat(label);
          });
        }
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }
    };
    copyAndNotify(inviteMessage, 'Convite copiado!');
  }, [room, isServer]);

  const handleCopyCode = useCallback(() => {
    if (!room) return;
    const code = room.code;
    try {
      if ((window as any).electron?.copyToClipboard) {
        (window as any).electron.copyToClipboard(code);
        notifyInChat('Código de convite copiado!');
      } else {
        navigator.clipboard.writeText(code).then(() => {
          notifyInChat('Código de convite copiado!');
        });
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }, [room]);

  const handleBackToMenu = useCallback(() => {
    useAppStore.getState().setRoom(null);
    navigate('/');
  }, [navigate]);

  const handleConfirmLeave = useCallback(async () => {
    if (!room) return;
    setIsLeaving(true);
    try {
      if (room.isServer || isServer) {
        await leaveServerFromSupabase(room.id, myName);
        removeMyServer(room.id);
        removeMyServer(room.code);
      }
    } catch (err) {
      console.warn('Erro ao sair do servidor:', err);
    } finally {
      setIsLeaving(false);
      setShowLeaveModal(false);
      useAppStore.getState().setRoom(null);
      navigate('/');
    }
  }, [room, isServer, myName, navigate]);

  return (
    <>
      <footer className={styles.footer}>
        {/* Left: connection & room status matching prototype */}
        <div className={styles.left}>
          <span className={styles.connectionStatus}>
            <span className={`${styles.statusDot} ${connected ? styles.connected : styles.disconnected}`} />
            <span>Conectado: {myName || 'Usuário'}</span>
          </span>

          {room && (
            <>
              <span className={styles.divider}>|</span>
              <span className={styles.serverTag} onClick={handleCopyCode} title="Clique para copiar código">
                {room.isServer || isServer ? 'Servidor:' : 'Sala:'}{' '}
                <strong>{room.code}</strong>
              </span>

              <span className={styles.divider}>|</span>
              {room.isServer || isServer ? (
                <span className={styles.permanentBadge}>Permanente</span>
              ) : timeLeft ? (
                <span className={`${styles.timerBadge} ${timeLeft.isWarning ? styles.timerWarning : ''}`}>
                  <i className="fa-regular fa-clock"></i>
                  {timeLeft.text}
                </span>
              ) : null}
            </>
          )}
        </div>

        {/* Right: Actions matching prototype */}
        <div className={styles.right}>
          {room && (
            <>
              <button
                type="button"
                className={`${styles.actionBtn} ${copied ? styles.actionBtnCopied : ''}`}
                onClick={handleCopyInvite}
                title="Copiar convite"
              >
                <i className="fa-solid fa-link" style={{ fontSize: '10px' }}></i>
                <span>{copied ? 'Copiado!' : 'Convidar'}</span>
              </button>

              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleBackToMenu}
                title="Voltar ao Menu Principal"
              >
                <i className="fa-solid fa-house" style={{ fontSize: '10px' }}></i>
                <span>Voltar ao Menu</span>
              </button>

              <button
                type="button"
                className={styles.leaveBtn}
                onClick={() => setShowLeaveModal(true)}
                title={room.isServer || isServer ? 'Sair do Servidor' : 'Sair da Sala'}
              >
                <i className="fa-solid fa-arrow-right-from-bracket" style={{ fontSize: '10px' }}></i>
                <span>{room.isServer || isServer ? 'Sair do Servidor' : 'Sair da Sala'}</span>
              </button>
            </>
          )}
        </div>
      </footer>

      {/* Confirmation Modal */}
      {showLeaveModal && (
        <div className={styles.modalOverlay} onClick={() => !isLeaving && setShowLeaveModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <i className={`fa-solid fa-triangle-exclamation ${styles.modalWarningIcon}`}></i>
              <h3 className={styles.modalTitle}>
                {room?.isServer || isServer ? 'Sair do Servidor?' : 'Sair da Sala?'}
              </h3>
            </div>
            <p className={styles.modalDescription}>
              {room?.isServer || isServer
                ? 'Tem certeza de que deseja sair deste servidor? Você deixará de ser membro e precisará de um código ou link de convite para entrar novamente.'
                : 'Tem certeza de que deseja sair desta sala temporária?'}
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setShowLeaveModal(false)}
                disabled={isLeaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.modalConfirmBtn}
                onClick={handleConfirmLeave}
                disabled={isLeaving}
              >
                {isLeaving ? 'Saindo...' : (room?.isServer || isServer ? 'Sair do Servidor' : 'Sair da Sala')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
