import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './BroadcasterScreenPanel.module.css';

interface Props {
  onStopSharing: () => void;
  onChangeSharing?: () => void;
}

export const BroadcasterScreenPanel: React.FC<Props> = ({ onStopSharing, onChangeSharing }) => {
  const { amSharing } = useAppStore();

  if (!amSharing) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🖥️</span>
          <h3 className={styles.headerTitle}>Sua Transmissão</h3>
          <span className={styles.liveBadge}>AO VIVO</span>
        </div>
        <button
          className={styles.closeBtn}
          onClick={onStopSharing}
          title="Parar Transmissão"
        >
          ✕
        </button>
      </div>

      <div className={styles.videoWrapper}>
        <div className={styles.placeholderContainer}>
          <div className={styles.pulseIcon}>📡</div>
          <span className={styles.placeholderTitle}>Sua tela está sendo transmitida</span>
          <span className={styles.placeholderSubtitle}>Prévia desativada para economia de desempenho</span>
        </div>
      </div>

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
