import React, { useEffect, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { useAppStore } from '../stores/useAppStore';
import styles from './ScreenSharePanel.module.css';

interface Props {
  onClose: () => void;
  onStopSharing?: () => void;
}

export const ScreenSharePanel: React.FC<Props> = ({ onClose, onStopSharing }) => {
  const { screenShareUserId, screenShareUserName, amSharing } = useAppStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP failed', err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleClose = () => {
    if (amSharing && onStopSharing) {
      onStopSharing();
    } else {
      onClose();
    }
  };

  if (!screenShareUserId && !amSharing) return null;

  // Calculate default position (top right with 16px margin)
  const defaultPosition = { x: typeof window !== 'undefined' ? window.innerWidth - 496 : 0, y: 16 };

  return (
    <div className={styles.overlay}>
      <Draggable nodeRef={containerRef} handle=".drag-handle" bounds="parent" defaultPosition={defaultPosition}>
        <div
          ref={containerRef}
          className={`${styles.panel} ${isFullscreen ? styles.fullscreen : ''}`}
        >
          <div className={`${styles.header} drag-handle`}>
            <div className={styles.titleArea}>
              <span className={styles.icon}>🖥️</span>
              <span className={styles.title}>
                {amSharing ? 'Você está compartilhando a tela' : `Tela de ${screenShareUserName}`}
              </span>
              <span className={styles.liveBadge}>AO VIVO</span>
            </div>
            <div className={styles.actions}>
              <button className={styles.actionBtn} onClick={togglePiP} title="Picture-in-Picture">
                📌
              </button>
              <button className={styles.actionBtn} onClick={toggleFullscreen} title="Tela Cheia">
                {isFullscreen ? '↙️' : '↗️'}
              </button>
              <button className={styles.closeBtn} onClick={handleClose} title={amSharing ? "Parar Transmissão" : "Fechar visualização"}>
                ✕
              </button>
            </div>
          </div>

          <div className={styles.videoContainer}>
            <video
              id="screen-share-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted={amSharing} // Mute self to prevent feedback loop
              className={styles.video}
            />
            {amSharing && (
              <div className={styles.sharingOverlay}>
                <div className={styles.sharingIcon}>📡</div>
                <p>Sua tela está sendo transmitida</p>
              </div>
            )}
          </div>
        </div>
      </Draggable>
    </div>
  );
};
