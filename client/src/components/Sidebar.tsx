import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { VoicePanel } from './VoicePanel';
import styles from './Sidebar.module.css';
import { 
  fetchServerChannels, 
  fetchServerMembers, 
  createChannelInSupabase, 
  registerServerMember 
} from '../lib/supabase';
import toast from 'react-hot-toast';

interface Props {
  onScreenShareClick: (userId: string) => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onAdminAction: (action: 'mute' | 'unmute' | 'kick_voice' | 'kick_room' | 'give_admin' | 'local_mute', targetId: string) => void;
  onCreateChannel?: (channelName: string) => void;
}

export const Sidebar: React.FC<Props> = ({ 
  onScreenShareClick,
  onJoinVoice,
  onLeaveVoice,
  onStartScreenShare,
  onStopScreenShare,
  onAdminAction,
  onCreateChannel,
}) => {
  const { 
    users, 
    myId, 
    myName, 
    connected, 
    room, 
    isServer, 
    channels, 
    setChannels, 
    addChannel, 
    activeChannelId, 
    setActiveChannelId,
    serverMembers,
    setServerMembers
  } = useAppStore();

  const { localMutedUsers, userVolumes, setUserVolume } = useAudioStore();

  const [showOnline, setShowOnline] = useState(true);
  const [showOffline, setShowOffline] = useState(false);
  const [showVoice, setShowVoice] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);

  // Modal para criação de novos canais
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);

  // Carregar canais e membros do servidor se for servidor permanente
  useEffect(() => {
    if (!room?.id || !isServer) return;

    // Registrar membro atual
    if (myName) {
      registerServerMember(room.id, myName);
    }

    // Buscar canais
    fetchServerChannels(room.id).then((chs) => {
      if (chs && chs.length > 0) {
        setChannels(chs.map(c => ({ id: c.id, name: c.name, serverId: c.server_id })));
      }
    });

    // Buscar membros registrados
    fetchServerMembers(room.id).then((mems) => {
      if (mems) {
        setServerMembers(mems.map(m => ({
          id: m.id,
          username: m.username,
          isOnline: false,
          inVoice: false,
          role: m.role,
        })));
      }
    });
  }, [room?.id, isServer, myName, setChannels, setServerMembers]);

  // Fechar menu de contexto no clique fora
  useEffect(() => {
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

  // Categorias de Usuários com fallback imediato para o usuário atual
  const effectiveUsers = users.length > 0 ? users : (myName ? [{
    id: myId || 'me',
    name: myName,
    inVoice: useAppStore.getState().inVoice,
    screenSharing: false,
    micMuted: false,
    callMuted: false
  }] : []);

  const voiceUsers = effectiveUsers.filter((u) => u.inVoice);
  const onlineUsers = effectiveUsers.filter((u) => !u.inVoice);
  
  // Usuários offline: membros do servidor que não estão presentes na lista `users` conectada
  const offlineMembers = serverMembers.filter(
    (m) => !effectiveUsers.some((u) => u.name && u.name.toLowerCase() === m.username.toLowerCase())
  );

  const isAdmin = room?.adminIds?.includes(myId) ?? false;

  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').slice(0, 25);
    if (!cleanName) {
      toast.error('Digite um nome válido para o canal');
      return;
    }

    if (channels.some(c => c.name === cleanName)) {
      toast.error('Já existe um canal com esse nome');
      return;
    }

    setIsCreatingChannel(true);
    try {
      if (room?.id) {
        await createChannelInSupabase(room.id, cleanName);
      }

      if (onCreateChannel) {
        onCreateChannel(cleanName);
      } else {
        addChannel({ id: `ch-${Date.now()}`, name: cleanName, serverId: room?.id });
      }

      toast.success(`Canal #${cleanName} criado!`);
      setNewChannelName('');
      setShowCreateChannelModal(false);
    } catch (err) {
      toast.error('Erro ao criar canal');
    } finally {
      setIsCreatingChannel(false);
    }
  };

  return (
    <aside className={styles.sidebar}>
      {/* Cabeçalho */}
      <div className={styles.header}>
        <div className={styles.serverName} title={room?.name || 'Concord'}>
          <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
          <span className={styles.serverTitleText}>
            {room?.name || 'Concord'}
          </span>
        </div>
        <div className={`${styles.statusDot} ${connected ? styles.connected : styles.disconnected}`} />
      </div>

      <div className={styles.sections}>
        {/* ── SEÇÃO DE CANAIS DE TEXTO (Para Servidores) ── */}
        {isServer && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>
              <div className={styles.sectionLabelLeft}>
                <span className={styles.sectionIcon}>💬</span>
                Canais de Texto
              </div>
              {isAdmin && (
                <button 
                  className={styles.addChannelBtn} 
                  onClick={() => setShowCreateChannelModal(true)}
                  title="Criar novo canal de texto"
                >
                  ➕
                </button>
              )}
            </div>

            <div className={styles.channelList}>
              {channels.map((channel) => {
                const isActive = (activeChannelId || 'ch-geral') === channel.id || (activeChannelId === 'ch-geral' && channel.name === 'geral');
                return (
                  <button
                    key={channel.id}
                    className={`${styles.channelItem} ${isActive ? styles.channelActive : ''}`}
                    onClick={() => setActiveChannelId(channel.id)}
                  >
                    <span className={styles.channelHash}>#</span>
                    <span className={styles.channelName}>{channel.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 1. USUÁRIOS NA CALL ── */}
        <section className={styles.section}>
          <div 
            className={`${styles.sectionLabel} ${styles.clickable}`}
            onClick={() => setShowVoice(!showVoice)}
          >
            <div className={styles.sectionLabelLeft}>
              <span className={styles.callBadgeDot}>🔴</span>
              Na Call — {voiceUsers.length}
            </div>
            <span className={`${styles.chevron} ${showVoice ? styles.chevronOpen : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </span>
          </div>

          <div className={`${styles.collapsibleWrapper} ${showVoice ? styles.expanded : ''}`}>
            <div className={styles.userList}>
              {voiceUsers.length === 0 ? (
                <div className={styles.emptyListHint}>Nenhum usuário na call</div>
              ) : (
                voiceUsers.map((user) => (
                  <UserCard
                    key={user.id}
                    id={user.id}
                    name={user.name || 'Anônimo'}
                    isMe={user.id === myId}
                    inVoice={user.inVoice}
                    screenSharing={user.screenSharing}
                    micMuted={user.micMuted}
                    callMuted={user.callMuted}
                    isAdmin={room?.adminIds?.includes(user.id) ?? false}
                    onScreenShareClick={onScreenShareClick}
                    onContextMenu={handleContextMenu}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        {/* ── 2. USUÁRIOS ONLINE ── */}
        <section className={styles.section}>
          <div 
            className={`${styles.sectionLabel} ${styles.clickable}`} 
            onClick={() => setShowOnline(!showOnline)}
          >
            <div className={styles.sectionLabelLeft}>
              <span className={styles.onlineBadgeDot}>🟢</span>
              Online — {isServer ? onlineUsers.length : effectiveUsers.length}
            </div>
            <span className={`${styles.chevron} ${showOnline ? styles.chevronOpen : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </span>
          </div>
          <div className={`${styles.collapsibleWrapper} ${showOnline ? styles.expanded : ''}`}>
            <div className={styles.userList}>
              {(isServer ? onlineUsers : effectiveUsers).map((user) => (
                <UserCard
                  key={user.id}
                  id={user.id}
                  name={user.name || 'Anônimo'}
                  isMe={user.id === myId}
                  inVoice={user.inVoice}
                  screenSharing={user.screenSharing}
                  micMuted={user.micMuted}
                  callMuted={user.callMuted}
                  isAdmin={room?.adminIds?.includes(user.id) ?? false}
                  onScreenShareClick={onScreenShareClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ── 3. USUÁRIOS OFFLINE (Apenas para Servidores) ── */}
        {isServer && (
          <section className={styles.section}>
            <div 
              className={`${styles.sectionLabel} ${styles.clickable}`} 
              onClick={() => setShowOffline(!showOffline)}
            >
              <div className={styles.sectionLabelLeft}>
                <span className={styles.offlineBadgeDot}>⚫</span>
                Offline — {offlineMembers.length}
              </div>
              <span className={`${styles.chevron} ${showOffline ? styles.chevronOpen : ''}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </span>
            </div>
            <div className={`${styles.collapsibleWrapper} ${showOffline ? styles.expanded : ''}`}>
              <div className={styles.userList}>
                {offlineMembers.length === 0 ? (
                  <div className={styles.emptyListHint}>Nenhum membro offline</div>
                ) : (
                  offlineMembers.map((member) => (
                    <div key={member.id} className={`${styles.userCard} ${styles.userCardOffline}`}>
                      <div className={`${styles.avatar} ${styles.avatarOffline}`}>
                        {member.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className={styles.userInfo}>
                        <span className={`${styles.userName} ${styles.userNameOffline}`}>
                          {member.username}
                          {member.role === 'owner' && <span className={styles.adminTag} title="Dono do Servidor">👑</span>}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      <VoicePanel
        onJoin={onJoinVoice}
        onLeave={onLeaveVoice}
        onStartScreenShare={onStartScreenShare}
        onStopScreenShare={onStopScreenShare}
      />

      {/* Modal de Criação de Canal */}
      {showCreateChannelModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateChannelModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Criar Canal de Texto</h3>
            <p className={styles.modalDesc}>Canais de texto servem para organizar conversas por assunto.</p>
            
            <form onSubmit={handleCreateChannelSubmit}>
              <div className={styles.channelInputWrapper}>
                <span className={styles.inputHash}>#</span>
                <input
                  type="text"
                  placeholder="ex: avisos, jogos, musica"
                  value={newChannelName}
                  maxLength={25}
                  onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className={styles.channelNameInput}
                  autoFocus
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowCreateChannelModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.confirmBtn}
                  disabled={isCreatingChannel || !newChannelName.trim()}
                >
                  {isCreatingChannel ? 'Criando...' : 'Criar Canal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Menu de Contexto de Usuário */}
      {contextMenu && (
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {room?.adminIds?.includes(myId) && !room?.adminIds?.includes(contextMenu.targetId) && (
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

          {users.find(u => u.id === contextMenu.targetId)?.inVoice && (
            <div className={styles.contextMenuSlider}>
              <label>Volume: {userVolumes[contextMenu.targetId] ?? 100}%</label>
              <input 
                type="range" 
                min="0" 
                max="200" 
                value={userVolumes[contextMenu.targetId] ?? 100}
                onChange={(e) => {
                  setUserVolume(contextMenu.targetId, parseInt(e.target.value));
                }}
              />
            </div>
          )}

          {room?.adminIds?.includes(myId) && users.find(u => u.id === contextMenu.targetId)?.inVoice && (
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
          {room?.adminIds?.includes(myId) && (
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
          {isAdmin && <span className={styles.adminTag} title="Dono / Admin">👑</span>}
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
