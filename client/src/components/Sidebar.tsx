import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { ProfileModal } from './ProfileModal';
import styles from './Sidebar.module.css';
import { 
  fetchServerChannels, 
  fetchServerMembers, 
  createChannelInSupabase, 
  deleteChannelInSupabase,
  updateChannelNameInSupabase,
  registerServerMember,
  updateServerNameInSupabase,
  updateServerLogoInSupabase,
  updateMemberRoleInSupabase,
  findRoomInSupabase,
  isUuid,
  supabase
} from '../lib/supabase';
import type { ServerChannel } from '../types';
import toast from 'react-hot-toast';

interface Props {
  onScreenShareClick: (userId: string) => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onAdminAction: (action: 'mute' | 'unmute' | 'kick_voice' | 'kick_room' | 'give_admin' | 'local_mute', targetId: string) => void;
  onCreateChannel?: (channelName: string) => void;
  onEditChannel?: (channelId: string, newName: string) => void;
  onDeleteChannel?: (channelId: string) => void;
  onUpdateServer?: (serverId: string, newName?: string, newIconUrl?: string) => void;
  onSetUserRole?: (targetId: string, role: 'owner' | 'sub_owner' | 'member') => void;
  onUpdateProfile?: (name: string, avatarUrl: string | null) => void;
}

export const Sidebar: React.FC<Props> = ({ 
  onScreenShareClick,
  onJoinVoice,
  onLeaveVoice,
  onStartScreenShare,
  onStopScreenShare,
  onAdminAction,
  onCreateChannel,
  onEditChannel,
  onDeleteChannel,
  onUpdateServer,
  onSetUserRole,
  onUpdateProfile,
}) => {
  const { 
    users, 
    myId, 
    myName, 
    myAvatarUrl,
    setMyName,
    setMyAvatarUrl,
    room, 
    isServer, 
    serverName,
    setServerName,
    serverIconUrl,
    setServerIconUrl,
    channels, 
    setChannels, 
    addChannel, 
    updateChannel,
    removeChannel,
    activeChannelId, 
    setActiveChannelId,
    serverMembers,
    setServerMembers,
    inVoice,
    amSharing,
    messages,
  } = useAppStore();

  const { localMutedUsers, userVolumes, setUserVolume, micMuted, callMuted, toggleMicMute, toggleCallMute } = useAudioStore();

  const [showOnline, setShowOnline] = useState(true);
  const [showOffline, setShowOffline] = useState(true);
  const [showVoice, setShowVoice] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);

  // Modal para criação de novos canais
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);

  // Modal para edição/renomeação de canais
  const [showEditChannelModal, setShowEditChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ServerChannel | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [isEditingChannel, setIsEditingChannel] = useState(false);

  // Modal para configurações do servidor (Nome e Logo)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  
  // Modal de Perfil de Usuário
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState<'server' | 'profile' | 'audio'>('server');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const myMember = serverMembers.find(m => m.username.toLowerCase() === (myName || '').toLowerCase());
  const isOwner = (room?.adminIds?.includes(myId) && !room?.subOwnerIds?.includes(myId)) || myMember?.role === 'owner' || (!room?.subOwnerIds?.includes(myId) && room?.adminIds?.[0] === myId);
  const isSubOwner = room?.subOwnerIds?.includes(myId) || myMember?.role === 'sub_owner';
  const canManageServer = isOwner || isSubOwner;

  // ── CONTROLE DE MENSAGENS NÃO LIDAS POR CANAL ──
  const [channelReadCounts, setChannelReadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const currentCh = activeChannelId || 'ch-geral';
    const totalInCurrent = messages.filter(
      (m) => (m.channelId || 'ch-geral') === currentCh || (currentCh === 'ch-geral' && !m.channelId)
    ).length;

    setChannelReadCounts((prev) => {
      if (prev[currentCh] === totalInCurrent) return prev;
      return { ...prev, [currentCh]: totalInCurrent };
    });
  }, [activeChannelId, messages]);

  // Carregar canais e membros do servidor se for servidor permanente
  useEffect(() => {
    if (!room?.id || !isServer) return;

    let isMounted = true;
    let memberSub: any = null;

    const cleanupSub = () => {
      if (memberSub) {
        try {
          supabase.removeChannel(memberSub);
        } catch {}
        memberSub = null;
      }
    };

    const loadMembers = async (actualServerId: string) => {
      const mems = await fetchServerMembers(actualServerId);
      if (isMounted && mems) {
        setServerMembers(mems.map(m => ({
          id: m.id,
          username: m.username,
          avatarUrl: (m as any).avatar_url || null,
          isOnline: false,
          inVoice: false,
          role: m.role as any,
        })));
      }
    };

    const setup = async () => {
      let actualServerId = room.id;
      if (!isUuid(room.id)) {
        const dbRoom = await findRoomInSupabase(room.id);
        if (dbRoom?.id && isUuid(dbRoom.id)) actualServerId = dbRoom.id;
      }

      if (!isMounted) return;

      // Registrar membro atual com dados completos do servidor
      if (myName) {
        await registerServerMember(
          actualServerId, 
          myName, 
          null, 
          isOwner ? 'owner' : isSubOwner ? 'sub_owner' : 'member',
          { 
            name: room.name || serverName, 
            code: room.code, 
            icon_url: serverIconUrl || room.iconUrl 
          }
        );
      }

      if (!isMounted) return;
      await loadMembers(actualServerId);

      // Buscar canais usando actualServerId
      fetchServerChannels(actualServerId).then((chs) => {
        if (isMounted && chs && chs.length > 0) {
          setChannels(chs.map(c => ({ id: c.id, name: c.name, serverId: c.server_id })));
        }
      });

      // Se actualServerId é UUID válido, iniciar listener em tempo real para presença/membros
      if (isUuid(actualServerId) && isMounted) {
        const topicName = `sidebar_members_${actualServerId}`;
        try {
          // Limpar qualquer canal anterior existente com este tópico para evitar "cannot add callbacks after subscribe()"
          const existingChannels = supabase.getChannels();
          const existing = existingChannels.find(c => c.topic === topicName || c.topic === `realtime:${topicName}`);
          if (existing) {
            try {
              supabase.removeChannel(existing);
            } catch {}
          }

          if (!isMounted) return;

          memberSub = supabase
            .channel(topicName)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'server_members',
                filter: `server_id=eq.${actualServerId}`,
              },
              () => {
                if (isMounted) loadMembers(actualServerId);
              }
            )
            .subscribe();
        } catch (subErr) {
          console.warn('[Realtime] Erro ao subscrever alterações de membros:', subErr);
        }
      }
    };

    setup();

    return () => {
      isMounted = false;
      cleanupSub();
    };
  }, [room?.id, isServer, myName, isOwner, isSubOwner, setChannels, setServerMembers, serverName, serverIconUrl]);

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
    avatarUrl: myAvatarUrl || null,
    inVoice: useAppStore.getState().inVoice,
    screenSharing: false,
    micMuted: false,
    callMuted: false
  }] : []);

  const voiceUsers = effectiveUsers.filter((u) => u.inVoice);
  // Regra de Presença: Usuários na call aparecem em "Na Call", outros em "Online"
  const onlineMembers = effectiveUsers.filter((u) => !u.inVoice);
  
  // Offline = Membro registrado no servidor que não está presente na lista ativa (app fechado ou no lobby)
  const offlineMembers = serverMembers.filter(
    (m) => !effectiveUsers.some((u) => u.name && u.name.trim().toLowerCase() === m.username.trim().toLowerCase())
  );

  // ─── CRIAÇÃO DE NOVO CANAL ─────────────────────────────────────────
  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageServer) {
      toast.error('Você não tem permissão para criar canais');
      return;
    }

    const cleanName = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 25);
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

  // ─── EDIÇÃO DE CANAL (Dono e Sub Dono) ──────────────────────────────
  const handleEditChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel || !canManageServer) {
      toast.error('Você não tem permissão para renomear canais');
      return;
    }

    const cleanName = editChannelName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 25);
    if (!cleanName) {
      toast.error('Digite um nome válido para o canal');
      return;
    }

    if (channels.some(c => c.id !== editingChannel.id && c.name.toLowerCase() === cleanName.toLowerCase())) {
      toast.error('Já existe um canal com esse nome');
      return;
    }

    setIsEditingChannel(true);
    try {
      if (room?.id) {
        await updateChannelNameInSupabase(room.id, editingChannel.id, cleanName);
      }

      if (onEditChannel) {
        onEditChannel(editingChannel.id, cleanName);
      } else {
        updateChannel(editingChannel.id, cleanName);
      }

      toast.success(`Canal renomeado para #${cleanName}!`);
      setShowEditChannelModal(false);
      setEditingChannel(null);
    } catch (err) {
      toast.error('Erro ao renomear canal');
    } finally {
      setIsEditingChannel(false);
    }
  };

  // ─── EXCLUSÃO DE CANAL (Apenas Dono) ────────────────────────────────
  const handleDeleteChannel = async (channelId: string) => {
    if (!isOwner) {
      toast.error('Apenas o Dono pode excluir canais');
      return;
    }

    try {
      if (room?.id) {
        await deleteChannelInSupabase(room.id, channelId);
      }
      if (onDeleteChannel) {
        onDeleteChannel(channelId);
      } else {
        removeChannel(channelId);
      }
      toast.success('Canal excluído com sucesso!');
    } catch (err) {
      toast.error('Erro ao excluir canal');
    }
  };

  // ─── EDIÇÃO DE SERVIDOR (LOGO E NOME) ──────────────────────────────
  const handleOpenSettings = () => {
    setProfileModalTab('server');
    setShowProfileModal(true);
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
    if (isOwner && (!trimmedName || trimmedName.length < 2 || trimmedName.length > 40)) {
      toast.error('O nome do servidor deve ter entre 2 e 40 caracteres');
      return;
    }

    setIsSavingSettings(true);
    try {
      // 1. Atualizar nome (apenas Dono)
      if (isOwner && trimmedName && trimmedName !== (room.name || serverName)) {
        const nameRes = await updateServerNameInSupabase(room.id, trimmedName);
        if (!nameRes.success) {
          toast.error(nameRes.message || 'Erro ao alterar o nome do servidor');
          setIsSavingSettings(false);
          return;
        }
        setServerName(trimmedName);
      }

      // 2. Atualizar logo (Dono e Sub Dono)
      if (editLogoUrl !== (serverIconUrl || room.iconUrl)) {
        await updateServerLogoInSupabase(room.id, editLogoUrl);
        setServerIconUrl(editLogoUrl || null);
      }

      // 3. Emitir evento socket para atualizar todos os membros
      if (onUpdateServer) {
        onUpdateServer(room.id, isOwner ? trimmedName : undefined, editLogoUrl);
      }

      toast.success('Servidor atualizado com sucesso!');
      setShowSettingsModal(false);
    } catch (err) {
      toast.error('Erro ao salvar alterações');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ─── GERENCIAMENTO DE CARGOS ─────────────────────────────────────────
  const handleSetRole = async (targetId: string, role: 'owner' | 'sub_owner' | 'member') => {
    const targetUser = users.find(u => u.id === targetId);
    if (!targetUser) return;

    if (onSetUserRole) {
      onSetUserRole(targetId, role);
    }

    if (room?.id && targetUser.name) {
      await updateMemberRoleInSupabase(room.id, targetUser.name, role);
    }

    toast.success(`Cargo de ${targetUser.name} atualizado para ${role === 'sub_owner' ? 'Sub Dono' : role === 'owner' ? 'Dono' : 'Membro'}`);
  };

  const targetUserInContextMenu = users.find(u => u.id === contextMenu?.targetId);
  const targetMemberEntry = targetUserInContextMenu ? serverMembers.find(m => m.username.toLowerCase() === targetUserInContextMenu.name.toLowerCase()) : null;
  const isTargetSubOwner = targetMemberEntry?.role === 'sub_owner' || room?.subOwnerIds?.includes(contextMenu?.targetId || '');

  return (
    <aside className={styles.sidebar}>
      {/* ── SERVER HEADER ── */}
      <div className={styles.header}>
        <div 
          className={styles.serverHeaderLeft}
          onClick={handleOpenSettings}
          style={{ cursor: 'pointer' }}
          title="Configurações do Servidor"
        >
          <div className={styles.serverAvatarWrapper}>
            {serverIconUrl || room?.iconUrl ? (
              <img src={serverIconUrl || room?.iconUrl || ''} alt="Server Avatar" className={styles.serverAvatarImg} />
            ) : (
              <div className={styles.serverAvatarFallback}>
                {(room?.name || serverName || 'Concord').charAt(0).toUpperCase()}
              </div>
            )}
            <span className={styles.serverOnlineBadge} />
          </div>
          <div className={styles.serverInfo}>
            <h1 className={styles.serverTitle} title={room?.name || serverName || 'Concord'}>
              <span>{room?.name || serverName || 'Concord'}</span>
              <i className="fa-solid fa-circle-check" style={{ color: '#7c5cff', fontSize: '12px' }} />
            </h1>
            <p className={styles.serverSubtitle}>
              {users.length} {users.length === 1 ? 'Membro' : 'Membros'} • {voiceUsers.length} na call
            </p>
          </div>
        </div>

        <button 
          className={styles.headerChevronBtn} 
          onClick={handleOpenSettings}
          title="Configurações do Servidor"
        >
          <i className="fa-solid fa-chevron-down" style={{ fontSize: '12px' }} />
        </button>
      </div>

      <div className={styles.sections}>
        {/* ── SEÇÃO DE CANAIS DE TEXTO ── */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <div className={styles.sectionLabelLeft}>
              <i className="fa-regular fa-comments" style={{ fontSize: '12px' }} />
              <span>Canais de Texto</span>
            </div>
            {isServer && canManageServer && (
              <button 
                className={styles.addChannelBtn} 
                onClick={() => setShowCreateChannelModal(true)}
                title="Criar novo canal de texto"
              >
                <i className="fa-solid fa-plus" />
              </button>
            )}
          </div>

          <div className={styles.channelList}>
            {(channels.length > 0 ? channels : [{ id: 'ch-geral', name: 'geral' }]).map((channel) => {
              const isActive = (activeChannelId || 'ch-geral') === channel.id || (activeChannelId === 'ch-geral' && (channel.name.toLowerCase() === 'geral'));
              const isGeral = channel.name.toLowerCase() === 'geral' || channel.id === 'ch-geral';
              const chId = channel.id || 'ch-geral';
              const totalInCh = messages.filter(
                (m) => (m.channelId || 'ch-geral') === chId || (chId === 'ch-geral' && !m.channelId)
              ).length;
              const readInCh = channelReadCounts[chId] ?? (isActive ? totalInCh : 0);
              const unreadCount = isActive ? 0 : Math.max(0, totalInCh - readInCh);

              return (
                <div key={channel.id} className={styles.channelRow}>
                  <button
                    className={`${styles.channelItem} ${isActive ? styles.channelActive : ''}`}
                    onClick={() => setActiveChannelId(channel.id)}
                  >
                    <span className={styles.channelItemLeft}>
                      <i className="fa-solid fa-hashtag" style={{ color: isActive ? '#7c5cff' : '#6b7280' }} />
                      <span className={styles.channelName}>{channel.name}</span>
                    </span>
                    {unreadCount > 0 && (
                      <span className={styles.channelBadge}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>
                  {isServer && !isGeral && (
                    <div className={styles.channelActions}>
                      {canManageServer && (
                        <button
                          className={styles.channelActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingChannel(channel);
                            setEditChannelName(channel.name);
                            setShowEditChannelModal(true);
                          }}
                          title={`Renomear canal #${channel.name}`}
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                      )}
                      {isOwner && (
                        <button
                          className={`${styles.channelActionBtn} ${styles.channelActionBtnDanger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Tem certeza que deseja excluir o canal #${channel.name}?`)) {
                              handleDeleteChannel(channel.id);
                            }
                          }}
                          title={`Excluir canal #${channel.name}`}
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── SEÇÃO DE CANAIS DE VOZ ── */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <div className={styles.sectionLabelLeft}>
              <i className="fa-solid fa-headset" style={{ fontSize: '12px' }} />
              <span>Canais de Voz</span>
            </div>
            {isServer && canManageServer && (
              <button className={styles.addChannelBtn} title="Criar canal de voz">
                <i className="fa-solid fa-plus" />
              </button>
            )}
          </div>

          <div className={styles.channelList}>
            <button
              className={`${styles.voiceChannelBtn} ${inVoice ? styles.channelActive : ''}`}
              onClick={() => {
                if (inVoice) onLeaveVoice();
                else onJoinVoice();
              }}
            >
              <span className={styles.voiceChannelLeft}>
                <i className="fa-solid fa-volume-high" style={{ color: inVoice ? '#7c5cff' : '#10b981' }} />
                <span>Call Geral</span>
              </span>
              <span className={styles.voiceCountBadge}>{voiceUsers.length}</span>
            </button>
          </div>
        </section>

        {/* ── 1. USUÁRIOS NA CALL ── */}
        <section className={styles.section}>
          <div 
            className={`${styles.sectionLabel} ${styles.clickable}`}
            onClick={() => setShowVoice(!showVoice)}
          >
            <div className={styles.sectionLabelLeft}>
              <span>Na Call — {voiceUsers.length}</span>
            </div>
            <span className={`${styles.chevron} ${showVoice ? styles.chevronOpen : ''}`}>
              <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px' }} />
            </span>
          </div>

          <div className={`${styles.collapsibleWrapper} ${showVoice ? styles.expanded : ''}`}>
            <div className={styles.userList}>
              {voiceUsers.length === 0 ? (
                <div className={styles.emptyCategory}>Nenhum usuário na call</div>
              ) : (
                voiceUsers.map((user) => {
                  const mem = serverMembers.find(m => m.username.toLowerCase() === (user.name || '').toLowerCase());
                  const isUserOwner = (room?.adminIds?.includes(user.id) && !room?.subOwnerIds?.includes(user.id)) || mem?.role === 'owner';
                  const isUserSubOwner = room?.subOwnerIds?.includes(user.id) || mem?.role === 'sub_owner';
                  const isCurrentUser = user.id === myId || (Boolean(user.name) && Boolean(myName) && user.name.trim().toLowerCase() === myName.trim().toLowerCase());
                  const userAvatar = user.avatarUrl || (isCurrentUser ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) || mem?.avatarUrl || null;

                  return (
                    <UserCard
                      key={user.id}
                      id={user.id}
                      name={user.name || 'Anônimo'}
                      avatarUrl={userAvatar}
                      isMe={isCurrentUser}
                      inVoice={user.inVoice}
                      screenSharing={user.screenSharing}
                      micMuted={isCurrentUser ? micMuted : user.micMuted}
                      callMuted={isCurrentUser ? callMuted : user.callMuted}
                      isOwner={isUserOwner}
                      isSubOwner={isUserSubOwner}
                      onScreenShareClick={onScreenShareClick}
                      onContextMenu={handleContextMenu}
                    />
                  );
                })
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
              <span>Online — {onlineMembers.length}</span>
            </div>
            <span className={`${styles.chevron} ${showOnline ? styles.chevronOpen : ''}`}>
              <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px' }} />
            </span>
          </div>
          <div className={`${styles.collapsibleWrapper} ${showOnline ? styles.expanded : ''}`}>
            <div className={styles.userList}>
              {onlineMembers.map((user) => {
                const mem = serverMembers.find(m => m.username.toLowerCase() === (user.name || '').toLowerCase());
                const isUserOwner = (room?.adminIds?.includes(user.id) && !room?.subOwnerIds?.includes(user.id)) || mem?.role === 'owner';
                const isUserSubOwner = room?.subOwnerIds?.includes(user.id) || mem?.role === 'sub_owner';
                const isCurrentUser = user.id === myId || (Boolean(user.name) && Boolean(myName) && user.name.trim().toLowerCase() === myName.trim().toLowerCase());
                const userAvatar = user.avatarUrl || (isCurrentUser ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) || mem?.avatarUrl || null;

                return (
                  <UserCard
                    key={user.id}
                    id={user.id}
                    name={user.name || 'Anônimo'}
                    avatarUrl={userAvatar}
                    isMe={isCurrentUser}
                    inVoice={user.inVoice}
                    screenSharing={user.screenSharing}
                    micMuted={isCurrentUser ? micMuted : user.micMuted}
                    callMuted={isCurrentUser ? callMuted : user.callMuted}
                    isOwner={isUserOwner}
                    isSubOwner={isUserSubOwner}
                    onScreenShareClick={onScreenShareClick}
                    onContextMenu={handleContextMenu}
                  />
                );
              })}
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
                <span>Offline — {offlineMembers.length}</span>
              </div>
              <span className={`${styles.chevron} ${showOffline ? styles.chevronOpen : ''}`}>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px' }} />
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
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt={member.username} className={styles.offlineUserAvatarImg} />
                        ) : (
                          <div className={styles.avatarFallback}>
                            {member.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className={styles.offlineDot} />
                      </div>
                      <span className={styles.offlineUserName}>{member.username}</span>
                      {member.role === 'owner' ? (
                        <i className={`fa-solid fa-crown ${styles.ownerCrown}`} title="Dono do Servidor" />
                      ) : member.role === 'sub_owner' ? (
                        <i className={`fa-solid fa-shield ${styles.subOwnerShield}`} title="Sub Dono" />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ── ACTIVE VOICE CALL FLOATING WIDGET ── */}
      {inVoice ? (
        <div className={styles.activeVoiceWidget}>
          <div className={styles.activeVoiceTop}>
            <div className={styles.activeVoiceLeft}>
              <span className={styles.pingDotWrapper}>
                <span className={styles.pingDotAnimate} />
                <span className={styles.pingDotSolid} />
              </span>
              <div style={{ lineHeight: 1.2 }}>
                <p className={styles.activeVoiceTitle}>Voz Conectada</p>
                <p className={styles.activeVoiceSubtitle}>Call Geral / 24ms</p>
              </div>
            </div>
            <button
              id="hangupBtn"
              onClick={onLeaveVoice}
              className={styles.hangupBtn}
              title="Desconectar da chamada"
            >
              <i className="fa-solid fa-phone-slash" style={{ fontSize: '12px' }} />
            </button>
          </div>
          <div className={styles.activeVoiceButtons}>
            <button
              onClick={onLeaveVoice}
              className={styles.leaveCallBtn}
            >
              <i className="fa-solid fa-power-off" style={{ fontSize: '10px' }} /> Sair Call
            </button>
            <button
              id="screenShareBtn"
              onClick={amSharing ? onStopScreenShare : onStartScreenShare}
              className={`${styles.screenBtn} ${amSharing ? styles.screenBtnActive : ''}`}
            >
              <i className="fa-solid fa-desktop" style={{ fontSize: '10px' }} /> {amSharing ? 'Parar Tela' : 'Tela'}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── USER CONTROL BAR (FOOTER) ── */}
      <div className={styles.userControlFooter}>
        <div className={styles.userControlLeft}>
          <div className={styles.myAvatarWrapper}>
            {myAvatarUrl ? (
              <img src={myAvatarUrl} alt={myName} className={styles.myAvatarImg} />
            ) : (
              <div className={styles.myAvatarFallback}>
                {(myName ? myName.charAt(0).toUpperCase() : '?')}
              </div>
            )}
            <span className={styles.myStatusDot} />
          </div>
          <div className={styles.myInfo}>
            <div className={styles.myNameText}>{myName || 'Usuário'}</div>
            <div className={styles.myTagText}>#{myId ? myId.slice(0, 4).toUpperCase() : '9921'}</div>
          </div>
        </div>
        <div className={styles.userControlButtons}>
          <button 
            id="micToggleBtn"
            className={`${styles.controlBtn} ${micMuted ? styles.controlBtnDanger : ''}`}
            onClick={toggleMicMute}
            title={micMuted ? "Ativar Microfone" : "Mutar Microfone"}
          >
            <i className={`fa-solid ${micMuted ? 'fa-microphone-slash' : 'fa-microphone'}`} style={{ fontSize: '12px' }} />
          </button>
          <button 
            id="deafenToggleBtn"
            className={`${styles.controlBtn} ${callMuted ? styles.controlBtnDanger : ''}`}
            onClick={toggleCallMute}
            title={callMuted ? "Ativar Áudio" : "Ensurdecer"}
          >
            <i className={`fa-solid ${callMuted ? 'fa-headphones-simple' : 'fa-headphones'}`} style={{ fontSize: '12px' }} />
          </button>
          <button 
            className={styles.controlBtn}
            onClick={() => {
              setProfileModalTab('profile');
              setShowProfileModal(true);
            }}
            title="Configurações de Perfil"
          >
            <i className="fa-solid fa-gear" style={{ fontSize: '12px' }} />
          </button>
        </div>
      </div>

      <div id="remote-audios" style={{ display: 'none' }} />

      {showProfileModal && (
        <ProfileModal 
          initialTab={profileModalTab}
          onClose={() => setShowProfileModal(false)}
          onUpdate={(newName, newAvatar) => {
            setMyName(newName);
            if (newAvatar !== undefined) {
              setMyAvatarUrl(newAvatar || null);
            }
            if (onUpdateProfile) {
              onUpdateProfile(newName, newAvatar || null);
            }
          }}
          onUpdateServer={onUpdateServer}
        />
      )}

      {/* ── MODAL: CRIAR NOVO CANAL DE TEXTO ── */}
      {showCreateChannelModal && createPortal(
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
        </div>,
        document.body
      )}

      {/* ── MODAL: RENOMEAR / EDITAR CANAL DE TEXTO ── */}
      {showEditChannelModal && editingChannel && createPortal(
        <div className={styles.modalOverlay} onClick={() => setShowEditChannelModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Renomear Canal de Texto</h3>
            <p className={styles.modalDesc}>
              Altere o nome do canal #{editingChannel.name}.
            </p>
            <form onSubmit={handleEditChannelSubmit}>
              <div className={styles.channelInputWrapper}>
                <span className={styles.inputHash}>#</span>
                <input
                  type="text"
                  className={styles.channelNameInput}
                  placeholder="Novo nome do canal"
                  value={editChannelName}
                  onChange={(e) => setEditChannelName(e.target.value)}
                  maxLength={25}
                  autoFocus
                />
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowEditChannelModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.confirmBtn}
                  disabled={isEditingChannel || !editChannelName.trim()}
                >
                  {isEditingChannel ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── MODAL: CONFIGURAÇÕES DO SERVIDOR (LOGO E NOME) ── */}
      {showSettingsModal && createPortal(
        <div className={styles.modalOverlay} onClick={() => setShowSettingsModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Configurações do Servidor</h3>
            <p className={styles.modalDesc}>
              Personalize o nome e a foto do seu servidor.
            </p>
            <form onSubmit={handleSaveSettings}>
              {/* Alterar Logo (Dono e Sub Dono) */}
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

              {/* Alterar Nome (Apenas Dono) */}
              <div className={styles.formGroupModal}>
                <label className={styles.modalInputLabel}>
                  Nome do Servidor {isOwner ? '(máx. 40 caracteres)' : '(bloqueado)'}
                </label>
                <input
                  type="text"
                  className={styles.modalTextInput}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={40}
                  minLength={2}
                  disabled={!isOwner}
                  required={isOwner}
                />
                {!isOwner && (
                  <span className={styles.disabledNotice}>
                    🔒 Apenas o Dono do servidor pode alterar o nome.
                  </span>
                )}
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
                  disabled={isSavingSettings || (isOwner && !editName.trim())}
                >
                  {isSavingSettings ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── CONTEXT MENU DO USUÁRIO ── */}
      {contextMenu && createPortal(
        <div 
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: nome + cargo */}
          <div className={styles.contextMenuHeader}>
            <span>{targetUserInContextMenu?.name ?? '...'}</span>
            <span className={styles.contextMenuUserTag}>
              {isTargetSubOwner ? '🛡 Sub Dono' : '👤 Membro'}
            </span>
          </div>

          {/* Slider de volume */}
          <div className={styles.contextMenuVolume}>
            <div className={styles.contextMenuVolumeLabel}>
              <span><i className="fa-solid fa-volume-high" style={{ marginRight: 4 }} />Volume do Usuário</span>
              <span>{userVolumes[contextMenu.targetId] ?? 100}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="200" 
              value={userVolumes[contextMenu.targetId] ?? 100}
              onChange={(e) => setUserVolume(contextMenu.targetId, Number(e.target.value))}
              style={{ width: '100%', accentColor: '#7c5cff' }}
            />
          </div>

          {/* Separador */}
          <div className={styles.contextMenuDivider} />

          {/* Silenciar para mim */}
          <button 
            className={styles.contextMenuItem}
            onClick={() => {
              onAdminAction('local_mute', contextMenu.targetId);
              setContextMenu(null);
            }}
          >
            <i className={`fa-solid ${localMutedUsers.includes(contextMenu.targetId) ? 'fa-volume-high' : 'fa-volume-xmark'}`} style={{ width: 14 }} />
            {localMutedUsers.includes(contextMenu.targetId) ? 'Desmutar para mim' : 'Silenciar para mim'}
          </button>

          {/* Promoção / rebaixamento (só Dono) */}
          {isOwner && (
            <>
              <div className={styles.contextMenuDivider} />
              {!isTargetSubOwner ? (
                <button 
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleSetRole(contextMenu.targetId, 'sub_owner');
                    setContextMenu(null);
                  }}
                >
                  <i className="fa-solid fa-shield" style={{ width: 14, color: '#7c5cff' }} />
                  Promover a Sub Dono
                </button>
              ) : (
                <button 
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleSetRole(contextMenu.targetId, 'member');
                    setContextMenu(null);
                  }}
                >
                  <i className="fa-solid fa-user" style={{ width: 14 }} />
                  Rebaixar para Membro
                </button>
              )}
            </>
          )}

          {/* Ações de moderação (Dono + Sub Dono) */}
          {canManageServer && (
            <>
              <div className={styles.contextMenuDivider} />
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  onAdminAction('mute', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-microphone-slash" style={{ width: 14 }} />
                Silenciar no Servidor
              </button>
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  onAdminAction('unmute', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-microphone" style={{ width: 14 }} />
                Desmutar no Servidor
              </button>
              <div className={styles.contextMenuDivider} />
              <button 
                className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                onClick={() => {
                  onAdminAction('kick_voice', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-phone-slash" style={{ width: 14 }} />
                Desconectar da Call
              </button>
              <button 
                className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                onClick={() => {
                  onAdminAction('kick_room', contextMenu.targetId);
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-ban" style={{ width: 14 }} />
                Expulsar da Sala
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </aside>
  );
};

// Sub-component: UserCard
interface UserCardProps {
  id: string;
  name: string;
  avatarUrl?: string | null;
  isMe: boolean;
  inVoice: boolean;
  screenSharing: boolean;
  micMuted: boolean;
  callMuted: boolean;
  isOwner: boolean;
  isSubOwner: boolean;
  onScreenShareClick: (userId: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const UserCard: React.FC<UserCardProps> = ({
  id,
  name,
  avatarUrl,
  isMe,
  inVoice,
  screenSharing,
  micMuted,
  callMuted,
  isOwner,
  isSubOwner,
  onScreenShareClick,
  onContextMenu,
}) => {
  const storeAvatar = useAppStore((s) => s.myAvatarUrl);
  const initials = name ? name.slice(0, 2).toUpperCase() : '??';
  const myAvatar = isMe ? (storeAvatar || localStorage.getItem('concord_avatar_url')) : null;
  const displayAvatar = avatarUrl || myAvatar;

  return (
    <div 
      id={`user-${id}`}
      data-user-id={id}
      className={`${styles.userCard} ${isMe ? styles.isMe : ''}`}
      onContextMenu={(e) => onContextMenu(e, id)}
    >
      <div className={styles.userCardLeft}>
        <div className={styles.avatarWrapper}>
          {displayAvatar ? (
            <img src={displayAvatar} alt={name} className={styles.avatarImg} />
          ) : (
            <div className={styles.avatarFallback}>{initials}</div>
          )}
          <span className={`${styles.statusBadge} ${inVoice ? styles.badgeVoice : styles.badgeOnline}`} />
        </div>

        <div className={styles.userDetails}>
          <div className={styles.userNameRow}>
            <span className={styles.userName}>{name}</span>
            {isMe && <span className={styles.meTag}>VOCÊ</span>}
            {isOwner ? (
              <i className={`fa-solid fa-crown ${styles.adminCrown}`} title="Dono do Servidor" />
            ) : isSubOwner ? (
              <i className={`fa-solid fa-shield ${styles.subOwnerShield}`} title="Sub Dono" />
            ) : null}
          </div>
          {screenSharing ? (
            <span className={styles.userSubtitle}>Transmitindo</span>
          ) : inVoice ? (
            <span className={styles.userSubtitle}>Na Call</span>
          ) : (
            <span className={styles.userGameSubtitle}>Online</span>
          )}
        </div>
      </div>

      <div className={styles.userCardRight}>
        {screenSharing && (
          <button
            className={styles.screenShareBtn}
            onClick={() => onScreenShareClick(id)}
            title="Ver transmissão de tela"
          >
            <i className="fa-solid fa-desktop" style={{ fontSize: '11px' }} />
          </button>
        )}
        {callMuted && (
          <span className={styles.statusIcon} title="Áudio da call mutado (Ensurdecido)">
            <i className="fa-solid fa-headphones" style={{ color: '#f43f5e', fontSize: '13px' }} />
          </span>
        )}
        {micMuted ? (
          <span className={styles.statusIcon} title="Microfone mutado">
            <i className="fa-solid fa-microphone-slash" style={{ color: '#f43f5e', fontSize: '13px' }} />
          </span>
        ) : inVoice ? (
          <span className={styles.statusIcon} title="Microfone ativo">
            <i className="fa-solid fa-microphone" style={{ color: '#10b981', fontSize: '13px' }} />
          </span>
        ) : null}
      </div>
    </div>
  );
};
