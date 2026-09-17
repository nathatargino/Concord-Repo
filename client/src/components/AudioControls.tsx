import React from 'react';
import { useAudioStore } from '../stores/useAudioStore';
import styles from './AudioControls.module.css';

interface Props {
  onUnlockAudio: () => void;
}

export const AudioControls: React.FC<Props> = ({ onUnlockAudio }) => {
  const {
    ytVol,
    micVol,
    remoteVol,
    micMuted,
    callMuted,
    setYtVol,
    setMicVol,
    setRemoteVol,
    toggleMicMute,
    toggleCallMute,
    resetAll,
  } = useAudioStore();

  const handlePointerDown = () => {
    onUnlockAudio();
  };

  return (
    <div className={styles.panel} onPointerDown={handlePointerDown}>
      {/* Header matching prototype */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <i className={`fa-solid fa-sliders ${styles.headerIcon}`}></i>
          <span>Controle de Áudio</span>
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={resetAll}
          title="Redefinir níveis de áudio"
        >
          <i className="fa-solid fa-rotate-left"></i>
        </button>
      </div>

      {/* Quick Mute Toggles matching prototype */}
      <div className={styles.togglesGrid}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${micMuted ? styles.toggleBtnMuted : ''}`}
          onClick={toggleMicMute}
          title={micMuted ? 'Ativar Microfone' : 'Mutar Microfone'}
        >
          <i
            className={`fa-solid ${micMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}
            style={{ color: micMuted ? '#f43f5e' : '#10b981' }}
          ></i>
          <span>{micMuted ? 'Mic Off' : 'Mic On'}</span>
        </button>

        <button
          type="button"
          className={`${styles.toggleBtn} ${callMuted ? styles.toggleBtnMuted : ''}`}
          onClick={toggleCallMute}
          title={callMuted ? 'Ativar Chamada' : 'Mutar Chamada'}
        >
          <i
            className={`fa-solid ${callMuted ? 'fa-phone-slash' : 'fa-phone'}`}
            style={{ color: callMuted ? '#f43f5e' : '#10b981' }}
          ></i>
          <span>{callMuted ? 'Call Off' : 'Call On'}</span>
        </button>
      </div>

      {/* Volume Sliders matching prototype */}
      <div className={styles.slidersList}>
        <div className={styles.sliderGroup}>
          <div className={styles.sliderHeader}>
            <span className={styles.sliderLabel}>
              <i className="fa-solid fa-microphone" style={{ color: '#7c5cff' }}></i>
              Microfone
            </span>
            <span className={styles.sliderValue}>{micVol}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={micVol}
            onChange={(e) => setMicVol(Number(e.target.value))}
            className={styles.rangeInput}
            disabled={micMuted}
          />
        </div>

        <div className={styles.sliderGroup}>
          <div className={styles.sliderHeader}>
            <span className={styles.sliderLabel}>
              <i className="fa-solid fa-users" style={{ color: '#7c5cff' }}></i>
              Voz dos Usuários
            </span>
            <span className={styles.sliderValue}>{remoteVol}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={remoteVol}
            onChange={(e) => setRemoteVol(Number(e.target.value))}
            className={styles.rangeInput}
            disabled={callMuted}
          />
        </div>

        <div className={styles.sliderGroup}>
          <div className={styles.sliderHeader}>
            <span className={styles.sliderLabel}>
              <i className="fa-brands fa-youtube" style={{ color: '#ef4444' }}></i>
              Som do YouTube/Stream
            </span>
            <span className={styles.sliderValue}>{ytVol}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={ytVol}
            onChange={(e) => setYtVol(Number(e.target.value))}
            className={styles.rangeInput}
            disabled={callMuted}
          />
        </div>
      </div>
    </div>
  );
};
