import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './VoicePanel.module.css';

interface Props {
  onJoin: () => void;
  onLeave: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
}

export const VoicePanel: React.FC<Props> = ({
  onJoin,
  onLeave,
  onStartScreenShare,
  onStopScreenShare,
}) => {
  const { inVoice, amSharing, users } = useAppStore();
  const [loading, setLoading] = useState(false);

  const handleVoiceClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (inVoice) {
        onLeave();
      } else {
        await onJoin();
      }
    } finally {
      setLoading(false);
    }
  };

  const voiceCount = users.filter((u) => u.inVoice).length;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🎙️</span>
        <h2 className={styles.headerTitle}>Chamada de Voz</h2>
        {voiceCount > 0 && (
          <span className={styles.voiceCount}>{voiceCount}</span>
        )}
      </div>

      <div className={styles.content}>
        {/* Voice Button */}
        <button
          id="btnJoinVoice"
          className={`${styles.voiceBtn} ${inVoice ? styles.voiceBtnActive : ''}`}
          onClick={handleVoiceClick}
          disabled={loading}
        >
          <div className={styles.voiceBtnInner}>
            <span className={styles.voiceBtnIcon}>
              {loading ? '⏳' : inVoice ? '📵' : '📞'}
            </span>
            <span className={styles.voiceBtnLabel}>
              {loading ? 'Conectando...' : inVoice ? 'Sair da Call' : 'Entrar na Call'}
            </span>
          </div>
          {inVoice && <div className={styles.activePulse} />}
        </button>

        {/* Screen Share Button (only when in voice) */}
        {inVoice && (
          <button
            className={`${styles.screenShareBtn} ${amSharing ? styles.screenShareActive : ''}`}
            onClick={amSharing ? onStopScreenShare : onStartScreenShare}
            title={amSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
          >
            <span className={styles.screenShareIcon}>🖥️</span>
            <span>{amSharing ? 'Parar Screen Share' : 'Compartilhar Tela'}</span>
          </button>
        )}

        {/* Status */}
        <div className={styles.statusArea}>
          {inVoice ? (
            <div className={styles.statusConnected}>
              <div className={styles.statusDot} />
              <span>Você está na chamada</span>
            </div>
          ) : (
            <p className={styles.statusIdle}>
              Entre na call para conversar por voz com todos
            </p>
          )}
        </div>
      </div>

      <div id="remote-audios" style={{ display: 'none' }} />
    </div>
  );
};
