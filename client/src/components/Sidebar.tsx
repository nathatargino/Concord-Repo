import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { VoicePanel } from './VoicePanel';
import styles from './Sidebar.module.css';
import { 
  fetchServerChannels, 
  fetchServerMembers, 
  createChannelInSupabase, 
  registerServerMember,
  updateServerNameInSupabase,
  updateServerLogoInSupabase
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
  onUpdateServer?: (serverId: string, newName?: string, newIconUrl?: string) => void;
}

export const Sidebar: React.FC<Props> = ({ 
  onScreenShareClick,
  onJoinVoice,
  onLeaveVoice,
  onStartScreenShare,
  onStopScreenShare,
  onAdminAction,
  onCreateChannel,
  onUpdateServer,
}) => {
  const { 
    users, 
    myId, 
    myName, 
    connected, 
    room, 
    isServer, 
    serverName,
    setServerName,
    serverIconUrl,
    setServerIconUrl,
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

  // Modal para configurações do servidor (Nome e Logo)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  // ─── CRIAÇÃO DE NOVO CANAL ─────────────────────────────────────────
  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newChannelName.trim().slice(0, 25);
    if (!cleanName) {
      toast.error('Digite um nome válido para o canal');
      return;
    }

    if (channels.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
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

  // ─── EDIÇÃO DE SERVIDOR (LOGO E NOME) ──────────────────────────────
  const handleOpenSettings = () => {
    setEditName(room?.name || serverName || '');
    setEditLogoUrl(serverIconUrl || room?.iconUrl || '');
    setShowSettingsModal(true);
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setEditLogoUrl(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room?.id) return;

    const trimmedName = editName.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 40) {
      toast.error('O nome do servidor deve ter entre 2 e 40 caracteres');
      return;
    }

    setIsSavingSettings(true);
    try {
      // 1. Atualizar nome (se mudou)
      if (trimmedName !== (room.name || serverName)) {
        const nameRes = await updateServerNameInSupabase(room.id, trimmedName);
        if (!nameRes.success) {
          toast.error(nameRes.message || 'Erro ao alterar o nome do servidor');
          setIsSavingSettings(false);
          return;
        }
        setServerName(trimmedName);
      }

      // 2. Atualizar logo (se mudou)
      if (editLogoUrl !== (serverIconUrl || room.iconUrl)) {
        await updateServerLogoInSupabase(room.id, editLogoUrl);
        setServerIconUrl(editLogoUrl || null);
      }

      // 3. Emitir evento socket para atualizar todos os membros
      if (onUpdateServer) {
        onUpdateServer(room.id, trimmedName, editLogoUrl);
      }

      toast.success('Servidor atualizado com sucesso!');
      setShowSettingsModal(false);
    } catch (err) {
      toast.error('Erro ao salvar alterações');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <aside className={styles.sidebar}>
      {/* Cabeçalho */}
      <div className={styles.header}>
        <div className={styles.serverName} title={room?.name || serverName || 'Concord'}>
          <div className={styles.serverLogoWrapper}>
            {serverIconUrl || room?.iconUrl ? (
              <img src={serverIconUrl || room?.iconUrl || ''} alt="Logo" className={styles.customServerLogo} />
            ) : (
              <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
            )}
          </div>
          <span className={styles.serverTitleText}>
            {room?.name || serverName || 'Concord'}
          </span>
        </div>

        {isServer && isAdmin && (
          <button 
            className={styles.serverSettingsBtn} 
            onClick={handleOpenSettings}
            title="Configurações do Servidor (Nome e Logo)"
          >
            ⚙️
          </button>
        )}

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
                const isActive = (activeChannelId || 'ch-geral') === channel.id || (activeChannelId === 'ch-geral' && (channel.name === 'geral' || channel.name === 'Geral'));
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
                <div className={styles.emptyCategory}>Nenhum usuário na call</div>
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
                  <div className={styles.emptyCategory}>Nenhum membro offline</div>
                ) : (
                  offlineMembers.map((member) => (
                    <div key={member.id} className={styles.offlineUserItem}>
                      <div className={styles.avatarWrapper}>
                        <div className={styles.avatarFallback}>
                          {member.username.charAt(0).toUpperCase()}
                        </div>
                        <div className={styles.offlineDot} />
                      </div>
                      <span className={styles.offlineUserName}>{member.username}</span>
                      {member.role === 'owner' && <span className={styles.ownerCrown} title="Dono do Servidor">👑</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Voice Controls */}
      <VoicePanel
        onJoinVoice={onJoinVoice}
        onLeaveVoice={onLeaveVoice}
        onStartScreenShare={onStartScreenShare}
        onStopScreenShare={onStopScreenShare}
      />

      {/* ── MODAL: CRIAR NOVO CANAL DE TEXTO ── */}
      {showCreateChannelModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateChannelModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Criar Canal de Texto</h3>
            <p className={styles.modalDesc}>
              Canais de texto servem para organizar conversas por tópicos específicos.
            </p>
            <form onSubmit={handleCreateChannelSubmit}>
              <div className={styles.channelInputWrapper}>
                <span className={styles.inputHash}>#</span>
                <input
                  type="text"
                  className={styles.channelNameInput}
                  placeholder="Ex: avisos, geral, musica"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  maxLength={25}
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

      {/* ── MODAL: CONFIGURAÇÕES DO SERVIDOR (LOGO E NOME) ── */}
      {showSettingsModal && (
        <div className={styles.modalOverlay} onClick={() => setShowSettingsModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Configurações do Servidor</h3>
            <p className={styles.modalDesc}>
              Personalize o nome e a foto do seu servidor. Apenas o Dono pode efetuar alterações.
            </p>
            <form onSubmit={handleSaveSettings}>
              {/* Alterar Logo */}
              <div className={styles.formGroupModal}>
                <label className={styles.modalInputLabel}>Logo do Servidor</label>
                <div className={styles.logoUploadContainer}>
                  <div className={styles.logoPreviewLarge}>
                    {editLogoUrl ? (
                      <img src={editLogoUrl} alt="Prévia" />
                    ) : (
                      <span>🛡️</span>
                    )}
                  </div>
                  <div>
                    <input 
                      type="file" 
                      ref={logoInputRef} 
                      className={styles.fileInputHidden} 
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleLogoFileUpload}
                    />
                    <button 
                      type="button" 
                      className={styles.uploadLogoBtn}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      📁 Escolher Imagem
                    </button>
                  </div>
                </div>
              </div>

              {/* Alterar Nome */}
              <div className={styles.formGroupModal}>
                <label className={styles.modalInputLabel}>Nome do Servidor (máx. 40 caracteres)</label>
                <input
                  type="text"
                  className={styles.modalTextInput}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={40}
                  minLength={2}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowSettingsModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.confirmBtn}
                  disabled={isSavingSettings || !editName.trim()}
                >
                  {isSavingSettings ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU DO USUÁRIO ── */}
      {contextMenu && (
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.contextMenuSlider}>
            <label>Volume do Usuário</label>
            <input 
              type="range" 
              min="0" 
              max="200" 
              value={userVolumes[contextMenu.targetId] ?? 100}
              onChange={(e) => setUserVolume(contextMenu.targetId, Number(e.target.value))}
            />
          </div>

          <button 
            className={styles.contextMenuItem}
            onClick={() => {
              onAdminAction('local_mute', contextMenu.targetId);
              setContextMenu(null);
            }}
          >
            {localMutedUsers.includes(contextMenu.targetId) ? '🔊 Desmutar para mim' : '🔇 Silenciar para mim'}
          </button>

          {isAdmin && (
            <>
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  onAdminAction('mute', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                🔇 Silenciar no Servidor
              </button>
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  onAdminAction('unmute', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                🔊 Desmutar no Servidor
              </button>
              <button 
                className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                onClick={() => {
                  onAdminAction('kick_voice', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                🚪 Desconectar da Call
              </button>
              <button 
                className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                onClick={() => {
                  onAdminAction('kick_room', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                🚫 Expulsar da Sala
              </button>
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  onAdminAction('give_admin', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                👑 Passar Dono/Admin
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

// Sub-component: UserCard
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
  const initials = name ? name.slice(0, 2).toUpperCase() : '??';

  return (
    <div 
      className={`${styles.userCard} ${isMe ? styles.isMe : ''}`}
      onContextMenu={(e) => onContextMenu(e, id)}
    >
      <div className={styles.avatarWrapper}>
        <div className={styles.avatarFallback}>{initials}</div>
        <div className={`${styles.statusBadge} ${inVoice ? styles.badgeVoice : styles.badgeOnline}`} />
      </div>

      <div className={styles.userInfo}>
        <div className={styles.userNameRow}>
          <span className={styles.userName}>{name}</span>
          {isMe && <span className={styles.meTag}>você</span>}
          {isAdmin && <span className={styles.adminCrown} title="Administrador">👑</span>}
        </div>

        <div className={styles.userStatusIcons}>
          {screenSharing && (
            <button
              className={styles.screenShareBtn}
              onClick={() => onScreenShareClick(id)}
              title="Ver compartilhamento"
            >
              📺
            </button>
          )}
          {micMuted && <span className={styles.statusIcon} title="Microfone mutado">🎤❌</span>}
          {callMuted && <span className={styles.statusIcon} title="Áudio mutado">🔇</span>}
        </div>
      </div>
    </div>
  );
};
