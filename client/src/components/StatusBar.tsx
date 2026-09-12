import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
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
    isWarning: ms < 30 * 60 * 1000, // < 30 min
    isCritical: ms < 5 * 60 * 1000, // < 5 min
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
        // Room expired
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
          toast.success(label);
        } else {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast.success(label);
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
        toast.success('Código copiado!');
      } else {
        navigator.clipboard.writeText(code).then(() => {
          toast.success('Código copiado!');
        });
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }, [room]);

  // Ação 2: Voltar ao Menu (Lobby) — Redireciona mantendo o vínculo e sem desconectar da conta
  const handleBackToMenu = useCallback(() => {
    useAppStore.getState().setRoom(null);
    navigate('/');
  }, [navigate]);

  // Ação 3: Sair do Servidor — Remove vínculo do usuário com o servidor
  const handleConfirmLeave = useCallback(async () => {
    if (!room) return;
    setIsLeaving(true);
    try {
      if (room.isServer || isServer) {
        await leaveServerFromSupabase(room.id, myName);
        removeMyServer(room.id);
        removeMyServer(room.code);
        toast.success('Você saiu do servidor.');
      } else {
        toast.success('Você saiu da sala.');
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

        {/* Center: server or room info */}
        {room && (
          <div className={styles.center}>
            <span className={styles.roomCode}>
              <span className={styles.codeLabel}>{room.isServer || isServer ? 'Servidor' : 'Sala'}</span>
              <span
                className={styles.codeValue}
                onClick={handleCopyCode}
                title="Clique para copiar o código de convite"
              >
                {room.code}
              </span>
            </span>
            {room.isServer || isServer ? (
              <>
                <span className={styles.timerSep}>•</span>
                <div className={styles.timer} title="Servidor Permanente sem expiração">
                  <span className={styles.timerIcon}>🛡️</span>
                  <span className={styles.timerText}>Permanente</span>
                </div>
              </>
            ) : timeLeft ? (
              <>
                <span className={styles.timerSep}>•</span>
                <div
                  className={`${styles.timer} ${timeLeft.isWarning ? styles.timerWarning : ''} ${timeLeft.isCritical ? styles.timerCritical : ''}`}
                  title="Tempo restante da sala"
                >
                  <span className={styles.timerIcon}>⏱</span>
                  <span className={styles.timerText}>{timeLeft.text}</span>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* Right: 3 distinct actions (Convidar, Voltar ao Menu, Sair do Servidor) */}
        <div className={styles.right}>
          {room && (
            <>
              {/* Ação 1: Convidar */}
              <button
                className={`${styles.inviteBtn} ${copied ? styles.inviteCopied : ''}`}
                onClick={handleCopyInvite}
                title={`Clique para copiar o convite:\n\nVocê foi convidado para ${(room.isServer || isServer) ? 'um servidor' : 'uma sala'} no Concord! Acesse o link abaixo para entrar:\n[link da sala]`}
              >
                {copied ? '✓ Copiado!' : '🔗 Convidar'}
              </button>

              {/* Ação 2: Voltar ao Menu */}
              <button
                className={styles.menuBtn}
                onClick={handleBackToMenu}
                title="Voltar para a tela inicial / lobby (permanece membro do servidor)"
              >
                🏠 Voltar ao Menu
              </button>

              {/* Ação 3: Sair do Servidor */}
              <button
                className={styles.leaveBtn}
                onClick={() => setShowLeaveModal(true)}
                title={room.isServer || isServer ? 'Desvincular-se e sair deste servidor' : 'Sair desta sala'}
              >
                {room.isServer || isServer ? '🚪 Sair do Servidor' : '🚪 Sair da Sala'}
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

      {/* Modal de Confirmação de Saída */}
      {showLeaveModal && (
        <div className={styles.modalOverlay} onClick={() => !isLeaving && setShowLeaveModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalWarningIcon}>⚠️</div>
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
