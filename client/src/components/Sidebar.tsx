import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { VoicePanel } from './VoicePanel';
import styles from './Sidebar.module.css';

interface Props {
  onScreenShareClick: (userId: string) => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onAdminAction: (action: 'mute' | 'unmute' | 'kick_voice' | 'kick_room' | 'give_admin' | 'local_mute', targetId: string) => void;
}

export const Sidebar: React.FC<Props> = ({ 
  onScreenShareClick,
  onJoinVoice,
  onLeaveVoice,
  onStartScreenShare,
  onStopScreenShare,
  onAdminAction,
}) => {
  const { users, myId, connected, room } = useAppStore();
  const { localMutedUsers } = useAudioStore();

  const voiceUsers = users.filter((u) => u.inVoice);

  const [showOnline, setShowOnline] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);

  React.useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    if (id !== myId) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, targetId: id });
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.serverName}>
          <span className={styles.serverIcon}>🎵</span>
          <span>Concord</span>
        </div>
        <div className={`${styles.statusDot} ${connected ? styles.connected : styles.disconnected}`} />
      </div>

      <div className={styles.sections}>
        {voiceUsers.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>
              Na call — {voiceUsers.length}
            </div>
            <div className={styles.userList}>
              {voiceUsers.map((user) => (
                <UserCard
                  key={user.id}
                  id={user.id}
                  name={user.name || 'Anônimo'}
                  isMe={user.id === myId}
                  inVoice={user.inVoice}
                  screenSharing={user.screenSharing}
                  micMuted={user.micMuted}
                  callMuted={user.callMuted}
                  isAdmin={user.id === room?.adminId}
                  onScreenShareClick={onScreenShareClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div 
            className={`${styles.sectionLabel} ${styles.clickable}`} 
            onClick={() => setShowOnline(!showOnline)}
          >
            <div className={styles.sectionLabelLeft}>
              <span className={styles.sectionIcon}>👥</span>
              Online — {users.length}
            </div>
            <span className={`${styles.chevron} ${showOnline ? styles.chevronOpen : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </span>
          </div>
          <div className={`${styles.collapsibleWrapper} ${showOnline ? styles.expanded : ''}`}>
            <div className={styles.userList}>
              {users.map((user) => (
                <UserCard
                  key={user.id}
                  id={user.id}
                  name={user.name || 'Anônimo'}
                  isMe={user.id === myId}
                  inVoice={user.inVoice}
                  screenSharing={user.screenSharing}
                  micMuted={user.micMuted}
                  callMuted={user.callMuted}
                  isAdmin={user.id === room?.adminId}
                  onScreenShareClick={onScreenShareClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <VoicePanel
        onJoin={onJoinVoice}
        onLeave={onLeaveVoice}
        onStartScreenShare={onStartScreenShare}
        onStopScreenShare={onStopScreenShare}
      />

      {contextMenu && (
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {room?.adminId === myId && (
            <button 
              onClick={() => { onAdminAction('give_admin', contextMenu.targetId); setContextMenu(null); }}
              className={styles.contextMenuItem}
            >
              👑 Dar Administrador
            </button>
          )}

          {localMutedUsers.includes(contextMenu.targetId) ? (
            <button 
              onClick={() => { onAdminAction('local_mute', contextMenu.targetId); setContextMenu(null); }}
              className={styles.contextMenuItem}
            >
              🔊 Desmutar para mim
            </button>
          ) : (
            <button 
              onClick={() => { onAdminAction('local_mute', contextMenu.targetId); setContextMenu(null); }}
              className={styles.contextMenuItem}
            >
              🔇 Mutar para mim
            </button>
          )}

          {room?.adminId === myId && users.find(u => u.id === contextMenu.targetId)?.inVoice && (
            <>
              {users.find(u => u.id === contextMenu.targetId)?.micMuted ? (
                <button 
                  onClick={() => { onAdminAction('unmute', contextMenu.targetId); setContextMenu(null); }}
                  className={styles.contextMenuItem}
                >
                  🔊 Desmutar para todos
                </button>
              ) : (
                <button 
                  onClick={() => { onAdminAction('mute', contextMenu.targetId); setContextMenu(null); }}
                  className={styles.contextMenuItem}
                >
                  🔇 Mutar para todos
                </button>
              )}
              <button 
                onClick={() => { onAdminAction('kick_voice', contextMenu.targetId); setContextMenu(null); }}
                className={styles.contextMenuItem}
              >
                📞 Desconectar da Voz
              </button>
            </>
          )}
          {room?.adminId === myId && (
            <button 
              onClick={() => { onAdminAction('kick_room', contextMenu.targetId); setContextMenu(null); }}
              className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            >
              🚪 Expulsar da Sala
            </button>
          )}
        </div>
      )}
    </aside>
  );
};

interface UserCardProps {
  id: string;
  name: string;
  isMe: boolean;
  inVoice: boolean;
  screenSharing: boolean;
  micMuted: boolean;
  callMuted: boolean;
  isAdmin: boolean;
  onScreenShareClick: (userId: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const UserCard: React.FC<UserCardProps> = ({
  id,
  name,
  isMe,
  inVoice,
  screenSharing,
  micMuted,
  callMuted,
  isAdmin,
  onScreenShareClick,
  onContextMenu,
}) => {
  const initials = name.slice(0, 2).toUpperCase();
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      id={`user-${id}`}
      className={`${styles.userCard} ${isMe ? styles.isMe : ''}`}
      onContextMenu={(e) => onContextMenu(e, id)}
    >
      <div
        id={`avatar-${id}`}
        className={styles.avatar}
        style={{ background: `hsl(${hue}, 60%, 40%)` }}
      >
        {initials}
      </div>

      <div className={styles.userInfo}>
        <span className={styles.userName}>
          {name}
          {isMe && <span className={styles.meTag}>você</span>}
          {isAdmin && <span className={styles.adminTag} title="Dono da sala">👑</span>}
        </span>
        <div className={styles.badges}>
          {callMuted && (
            <span className={`${styles.badge} ${styles.mutedBadge}`} title="Áudio e Mic Mutados">
              🎧
            </span>
          )}
          {!callMuted && micMuted && (
            <span className={`${styles.badge} ${styles.mutedBadge}`} title="Microfone Mutado">
              🔇
            </span>
          )}
          {inVoice && (
            <span className={styles.badge} title="Na call de voz">
              🎙️
            </span>
          )}
          {screenSharing && (
            <button
              className={styles.screenShareBadge}
              onClick={() => onScreenShareClick(id)}
              title={`Ver tela de ${name}`}
            >
              🖥️ Ver tela
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
