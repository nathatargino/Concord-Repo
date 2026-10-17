import React, { useState } from 'react';
import { useAudioStore } from '../stores/useAudioStore';
import styles from './AudioControls.module.css';

const AUDIO_CONTROLS_KEY = 'concord_audio_controls_open';

interface Props {
  onUnlockAudio: () => void;
}

export const AudioControls: React.FC<Props> = ({ onUnlockAudio }) => {
  const audioStore = useAudioStore();
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
  } = audioStore;

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUDIO_CONTROLS_KEY);
      // Padrão: Aberto (true), a não ser que tenha sido expressamente salvo como 'false'
      if (saved === 'false') return false;
      return true;
    } catch {
      return true;
    }
  });

  const toggleDropdown = () => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUDIO_CONTROLS_KEY, String(next));
        const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
        if (isElectron && (window as any).electron?.savePreferences) {
          (window as any).electron.savePreferences({ [AUDIO_CONTROLS_KEY]: String(next) });
        }
      } catch {}
      return next;
    });
  };

  const handlePointerDown = () => {
    onUnlockAudio();
  };

  return (
    <div
      className={`${styles.panel} ${!isOpen ? styles.panelCollapsed : ''}`}
      onPointerDown={handlePointerDown}
    >
      {/* Header Dropdown (Clique para Expandir/Recolher) */}
      <div
        className={`${styles.header} ${!isOpen ? styles.headerCollapsed : ''}`}
        onClick={toggleDropdown}
        role="button"
        tabIndex={0}
        title={isOpen ? 'Recolher Controle de Áudio' : 'Expandir Controle de Áudio'}
      >
        <div className={styles.headerLeft}>
          <i className={`fa-solid fa-sliders ${styles.headerIcon}`}></i>
          <span>Controle de Áudio</span>
          <i
            className={`fa-solid fa-chevron-down ${styles.chevronIcon} ${isOpen ? styles.chevronOpen : ''}`}
          ></i>
        </div>

        <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={(e) => {
              e.stopPropagation();
              resetAll();
            }}
            title="Redefinir níveis de áudio"
          >
            <i className="fa-solid fa-rotate-left"></i>
          </button>
        </div>
      </div>

      {/* Conteúdo Expansível / Dropdown */}
      {isOpen && (
        <div className={styles.dropdownBody}>
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
              <i className="fa-solid fa-tv" style={{ color: '#a78bfa' }}></i>
              Streaming
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
  )}
</div>
);
};
