import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import styles from './FloatingCallBar.module.css';

interface FloatingCallBarProps {
  onLeaveVoice: () => void;
  onToggleMic?: () => void;
  onToggleDeafen?: () => void;
}

export const FloatingCallBar: React.FC<FloatingCallBarProps> = ({
  onLeaveVoice,
  onToggleMic,
  onToggleDeafen,
}) => {
  const navigate = useNavigate();
  const { inVoice, activeCallInfo, setActiveRailContext } = useAppStore();
  const { micMuted, setMicMuted, callMuted, setCallMuted } = useAudioStore();

  if (!inVoice || !activeCallInfo) return null;

  const handleReturnToCall = () => {
    setActiveRailContext(activeCallInfo.roomId);
    navigate(
      `/room/${activeCallInfo.roomId}?code=${activeCallInfo.code}${
        activeCallInfo.isServer ? '&server=1' : ''
      }`
    );
  };

  const handleMicClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleMic) {
      onToggleMic();
    } else {
      setMicMuted(!micMuted);
    }
  };

  const handleDeafenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleDeafen) {
      onToggleDeafen();
    } else {
      setCallMuted(!callMuted);
    }
  };

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onLeaveVoice();
  };

  return (
    <div className={styles.bar}>
      <div className={styles.info} onClick={handleReturnToCall} title="Clique para voltar à sala">
        <span className={styles.pulseDot} />
        <div className={styles.texts}>
          <span className={styles.statusLabel}>Voz Conectada</span>
          <span className={styles.roomName}>{activeCallInfo.roomName || 'Chamada'}</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          className={`${styles.iconBtn} ${micMuted ? styles.muted : ''}`}
          onClick={handleMicClick}
          title={micMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}
        >
          <i className={micMuted ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone'} />
        </button>

        <button
          className={`${styles.iconBtn} ${callMuted ? styles.muted : ''}`}
          onClick={handleDeafenClick}
          title={callMuted ? 'Desativar Silenciar Áudio' : 'Silenciar Áudio (Deafen)'}
        >
          <i className={callMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-headphones'} />
        </button>

        <button
          className={styles.returnBtn}
          onClick={handleReturnToCall}
          title="Voltar para a chamada"
        >
          <i className="fa-solid fa-arrow-up-right-from-square" />
          <span>Voltar à Call</span>
        </button>

        <button
          className={styles.disconnectBtn}
          onClick={handleDisconnect}
          title="Desconectar da chamada"
        >
          <i className="fa-solid fa-phone-slash" />
        </button>
      </div>
    </div>
  );
};
