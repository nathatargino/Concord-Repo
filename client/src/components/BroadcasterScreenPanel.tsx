import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './BroadcasterScreenPanel.module.css';

interface Props {
  onStopSharing: () => void;
  onChangeSharing?: () => void;
  localStream?: MediaStream | null;
}

export const BroadcasterScreenPanel: React.FC<Props> = ({ onStopSharing, onChangeSharing }) => {
  const { amSharing, screenViewers, users, myId, screenShareUserId, setScreenShare } = useAppStore();

  if (!amSharing) return null;

  const otherBroadcasters = users.filter((u) => u.screenSharing && u.id !== myId);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🖥️</span>
          <h3 className={styles.headerTitle}>Sua Transmissão</h3>
          <span className={styles.liveBadge}>AO VIVO</span>
        </div>

        <div className={styles.headerRight}>
          <div 
            className={styles.viewerBadge} 
            title={screenViewers.length > 0 ? `Espectadores: ${screenViewers.map(v => v.name).join(', ')}` : 'Ninguém assistindo no momento'}
          >
            <span className={styles.eyeIcon}>👁️</span>
            <span className={styles.viewerCount}>{screenViewers.length}</span>
            {screenViewers.length > 0 && (
              <div className={styles.viewerTooltip}>
                <span className={styles.tooltipTitle}>Assistindo ({screenViewers.length}):</span>
                {screenViewers.map((v) => (
                  <div key={v.id} className={styles.viewerNameItem}>
                    {v.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className={styles.closeBtn}
            onClick={onStopSharing}
            title="Parar Transmissão"
          >
            ✕
          </button>
        </div>
      </div>

      <div className={styles.videoWrapper}>
        <div className={styles.placeholderContainer}>
          <div className={styles.pulseIcon}>📡</div>
          <span className={styles.placeholderTitle}>Sua tela está sendo transmitida</span>
          <span className={styles.placeholderSubtitle}>Prévia oculta para máxima performance e sem lag</span>
        </div>
      </div>

      {otherBroadcasters.length > 0 && (
        <div className={styles.otherStreamsSection}>
          <span className={styles.otherStreamsLabel}>
            Outras transmissões na chamada ({otherBroadcasters.length}):
          </span>
          <div className={styles.otherStreamsList}>
            {otherBroadcasters.map((u) => {
              const isWatching = screenShareUserId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`${styles.watchOtherBtn} ${isWatching ? styles.watchOtherBtnActive : ''}`}
                  onClick={() => {
                    if (isWatching) {
                      setScreenShare(null);
                    } else {
                      setScreenShare(u.id, u.name);
                    }
                  }}
                  title={isWatching ? `Parar de assistir ${u.name}` : `Assistir tela de ${u.name}`}
                >
                  <span className={styles.watchOtherIcon}>📺</span>
                  <span className={styles.watchOtherName}>
                    {isWatching ? `Assistindo ${u.name}` : `Assistir tela de ${u.name}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        {onChangeSharing && (
          <button
            className={styles.changeBtn}
            onClick={onChangeSharing}
            title="Trocar janela, guia ou tela inteira"
          >
            🔄 Trocar Tela
          </button>
        )}
        <button
          className={styles.stopBtn}
          onClick={onStopSharing}
          title="Encerrar compartilhamento"
        >
          🛑 Parar
        </button>
      </div>
    </div>
  );
};
