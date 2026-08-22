import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { VoicePanel } from './VoicePanel';
import styles from './Sidebar.module.css';

interface Props {
  onScreenShareClick: (userId: string) => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
}

export const Sidebar: React.FC<Props> = ({ 
  onScreenShareClick,
  onJoinVoice,
  onLeaveVoice,
  onStartScreenShare,
  onStopScreenShare,
}) => {
  const { users, myId, connected } = useAppStore();

  const voiceUsers = users.filter((u) => u.inVoice);

  const [showOnline, setShowOnline] = useState(false);

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
                  inVoice
                  screenSharing={user.screenSharing}
                  onScreenShareClick={onScreenShareClick}
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
                  onScreenShareClick={onScreenShareClick}
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
    </aside>
  );
};

interface UserCardProps {
  id: string;
  name: string;
  isMe: boolean;
  inVoice: boolean;
  screenSharing: boolean;
  onScreenShareClick: (userId: string) => void;
}

const UserCard: React.FC<UserCardProps> = ({
  id,
  name,
  isMe,
  inVoice,
  screenSharing,
  onScreenShareClick,
}) => {
  const initials = name.slice(0, 2).toUpperCase();
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      id={`user-${id}`}
      className={`${styles.userCard} ${isMe ? styles.isMe : ''}`}
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
        </span>
        <div className={styles.badges}>
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
