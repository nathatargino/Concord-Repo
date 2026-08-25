import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './BroadcasterScreenPanel.module.css';

interface Props {
  onStopSharing: () => void;
  screenStream?: MediaStream | null;
}

export const BroadcasterScreenPanel: React.FC<Props> = ({ onStopSharing, screenStream }) => {
  const { amSharing } = useAppStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
      if (screenStream) {
        if (videoEl.srcObject !== screenStream) {
          videoEl.srcObject = screenStream;
        }
        videoEl.play().catch((err) => {
          console.debug('[BroadcasterScreenPanel] video play error:', err);
        });
      } else {
        videoEl.srcObject = null;
      }
    }
  }, [screenStream]);

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
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.video}
        />
        <div className={styles.overlayInfo}>
          <div className={styles.statusTag}>
            <span className={styles.statusDot} />
            Transmitindo tela
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <button
          className={styles.stopBtn}
          onClick={onStopSharing}
        >
          🛑 Parar Compartilhamento
        </button>
      </div>
    </div>
  );
};
