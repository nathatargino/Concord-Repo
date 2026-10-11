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
  leaveServerFromSupabase,
  findRoomInSupabase,
  isUuid,
  supabase,
  removeLocalServerMember,
  formatRoomTimeRemaining,
  removeRecentRoom,
  sendFriendRequestToSupabase,
  cancelFriendRequestInSupabase,
  fetchFriendsFromSupabase,
  blockUserInSupabase,
  unblockUserInSupabase,
  getOrCreatePersistentId,
} from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { ServerChannel, CustomRole } from '../types';
import { notifyInChat } from '../utils/systemMessage';
import { ManageRolesModal } from './ManageRolesModal';

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
  onSetCustomRole?: (payload: { roomId: string; targetUserId: string; targetUsername: string; customRole: CustomRole | null }) => void;
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
  onSetCustomRole,
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
    myRole,
    inVoice,
    amSharing,
    messages,
    openUserProfile,
    activeRailContext,
    setActiveRailContext,
    recentRooms,
    refreshRecentRooms,
    openActionModal,
    setIsServer,
    myTag,
    homeTab,
    setHomeTab,
    friends,
    setFriends,
    directChats,
    activeDmChat,
    setActiveDmChat,
    setCreateRoomPromptOpen,
    activeCallInfo,
  } = useAppStore();

  const [copiedFooterUser, setCopiedFooterUser] = useState(false);

  const navigate = useNavigate();

  const { localMutedUsers, userVolumes, setUserVolume, micMuted, callMuted, toggleMicMute, toggleCallMute } = useAudioStore();

  const [showOnline, setShowOnline] = useState(true);
  const [showOffline, setShowOffline] = useState(true);
  const [showVoice, setShowVoice] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ 
    x: number; 
    y: number; 
    targetId: string;
    targetName?: string;
    isOffline?: boolean;
  } | null>(null);

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
  const [logoError, setLogoError] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const isEffectiveServer = Boolean(
    isServer || 
    room?.isServer || 
    room?.id?.toUpperCase().startsWith('SRV-') || 
    room?.code?.toUpperCase().startsWith('SRV-')
  );

  const cleanMyName = (myName || '').trim().toLowerCase();
  const myMember = serverMembers.find(m => (m.username || '').trim().toLowerCase() === cleanMyName);
  const effectiveMyAvatar = 
    myAvatarUrl || 
    localStorage.getItem('concord_avatar_url') || 
    users.find(u => u.id === myId || (Boolean(myName) && Boolean(u.name) && u.name.trim().toLowerCase() === cleanMyName))?.avatarUrl || 
    myMember?.avatarUrl || 
    null;

  const [avatarLoadError, setAvatarLoadError] = useState(false);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [effectiveMyAvatar]);

  useEffect(() => {
    if (!myAvatarUrl && effectiveMyAvatar) {
      setMyAvatarUrl(effectiveMyAvatar);
      try {
        localStorage.setItem('concord_avatar_url', effectiveMyAvatar);
      } catch (err) {
        console.warn('Erro ao salvar concord_avatar_url:', err);
      }
    }
  }, [myAvatarUrl, effectiveMyAvatar, setMyAvatarUrl]);
  // Modal para gerenciamento de cargos (Nome + Emoji)
  const [manageRoleTarget, setManageRoleTarget] = useState<{
    userId: string;
    username: string;
    avatarUrl?: string | null;
    customRole?: CustomRole | null;
  } | null>(null);

  const isOwner = isEffectiveServer
    ? (myMember?.role === 'owner' || 
       myRole === 'owner' || 
       users.find(u => u.id === myId)?.role === 'owner' || 
       (Boolean(room?.ownerId) && (room?.ownerId === myId || room?.ownerId === getOrCreatePersistentId())))
    : (Boolean(room?.adminIds?.includes(myId) && !room?.subOwnerIds?.includes(myId)));

  const isSubOwner = 
    !isOwner && (
      myMember?.role === 'sub_owner' || 
      myRole === 'sub_owner' || 
      users.find(u => u.id === myId)?.role === 'sub_owner' ||
      Boolean(room?.subOwnerIds?.includes(myId)) ||
      Boolean(myMember?.customRole?.isAdmin) ||
      Boolean(users.find(u => u.id === myId)?.customRole?.isAdmin)
    );

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
    if (!room?.id || !isEffectiveServer) return;

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
        setServerMembers((prev) => {
          const map = new Map<string, typeof serverMembers[0]>();
          for (const m of prev) {
            map.set(m.username.trim().toLowerCase(), m);
          }
          for (const m of mems) {
            const key = m.username.trim().toLowerCase();
            const existing = map.get(key);
            map.set(key, {
              id: m.id || existing?.id || m.username,
              username: m.username,
              avatarUrl: (m as any).avatar_url || (m as any).avatarUrl || existing?.avatarUrl || null,
              isOnline: existing?.isOnline ?? false,
              inVoice: existing?.inVoice ?? false,
              role: (m.role as any) || existing?.role || 'member',
            });
          }
          return Array.from(map.values());
        });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, isEffectiveServer, myName, setChannels, setServerMembers, serverName, serverIconUrl]);

  // Fechar menu de contexto no clique fora
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, id: string, name?: string, isOffline?: boolean) => {
    e.preventDefault();
    if (id === myId) return;
    if (name && myName && name.trim().toLowerCase() === myName.trim().toLowerCase()) return;

    // Ajustar posicionamento para não cortar na borda da tela
    const menuWidth = 220;
    const menuHeight = 340;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);

    setContextMenu({ 
      x: Math.max(10, x), 
      y: Math.max(10, y), 
      targetId: id,
      targetName: name,
      isOffline: Boolean(isOffline)
    });
  };

  // Categorias de Usuários com fallback imediato para o usuário atual
  const effectiveUsers = React.useMemo(() => {
    if (users.length > 0) return users;
    if (!myName) return [];
    return [{
      id: myId || 'me',
      name: myName,
      avatarUrl: myAvatarUrl || null,
      inVoice: Boolean(inVoice),
      screenSharing: false,
      micMuted: false,
      callMuted: false
    }];
  }, [users, myName, myId, myAvatarUrl, inVoice]);

  const voiceUsers = effectiveUsers.filter((u) => u.inVoice);
  // Regra de Presença: Usuários na call aparecem em "Na Call", outros em "Online"
  const onlineMembers = effectiveUsers.filter((u) => !u.inVoice);
  
  // Offline = Membro registrado no servidor que não está presente na lista ativa (app fechado ou no lobby)
  const offlineMembers = React.useMemo(() => {
    const activeNames = new Set(
      effectiveUsers.map((u) => (u.name || '').trim().toLowerCase()).filter(Boolean)
    );
    if (myName) {
      activeNames.add(myName.trim().toLowerCase());
    }
    const seen = new Set<string>();
    const list: typeof serverMembers = [];

    for (const m of serverMembers) {
      const cleanName = (m.username || '').trim().toLowerCase();
      if (!cleanName) continue;
      if (activeNames.has(cleanName)) continue;
      if (seen.has(cleanName)) continue;
      seen.add(cleanName);
      list.push(m);
    }
    return list;
  }, [serverMembers, effectiveUsers, myName]);

  // ─── CRIAÇÃO DE NOVO CANAL ─────────────────────────────────────────
  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageServer) {
      notifyInChat('Você não tem permissão para criar canais');
      return;
    }

    const cleanName = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 25);
    if (!cleanName) {
      notifyInChat('Digite um nome válido para o canal');
      return;
    }

    if (channels.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
      notifyInChat('Já existe um canal com esse nome');
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

      notifyInChat(`Canal #${cleanName} criado!`);
      setNewChannelName('');
      setShowCreateChannelModal(false);
    } catch (err) {
      notifyInChat('Erro ao criar canal');
    } finally {
      setIsCreatingChannel(false);
    }
  };

  // ─── EDIÇÃO DE CANAL (Dono e Sub Dono) ──────────────────────────────
  const handleEditChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel || !canManageServer) {
      notifyInChat('Você não tem permissão para renomear canais');
      return;
    }

    const cleanName = editChannelName.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 25);
    if (!cleanName) {
      notifyInChat('Digite um nome válido para o canal');
      return;
    }

    if (channels.some(c => c.id !== editingChannel.id && c.name.toLowerCase() === cleanName.toLowerCase())) {
      notifyInChat('Já existe um canal com esse nome');
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

      notifyInChat(`Canal renomeado para #${cleanName}!`);
      setShowEditChannelModal(false);
      setEditingChannel(null);
    } catch (err) {
      notifyInChat('Erro ao renomear canal');
    } finally {
      setIsEditingChannel(false);
    }
  };

  // ─── EXCLUSÃO DE CANAL (Apenas Dono) ────────────────────────────────
  const handleDeleteChannel = async (channelId: string) => {
    if (!isOwner) {
      notifyInChat('Apenas o Dono pode excluir canais');
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
      notifyInChat('Canal excluído com sucesso!');
    } catch (err) {
      notifyInChat('Erro ao excluir canal');
    }
  };

  // ─── EDIÇÃO DE SERVIDOR (LOGO E NOME) ──────────────────────────────
  const handleOpenSettings = () => {
    setProfileModalTab('server');
    setShowProfileModal(true);
  };

  useEffect(() => {
    const handleOpenSettingsEvent = () => {
      setProfileModalTab('server');
      setShowProfileModal(true);
    };
    window.addEventListener('concord:open-server-settings', handleOpenSettingsEvent);
    return () => window.removeEventListener('concord:open-server-settings', handleOpenSettingsEvent);
  }, []);

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      notifyInChat('A imagem deve ter no máximo 2MB');
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
      notifyInChat('O nome do servidor deve ter entre 2 e 40 caracteres');
      return;
    }

    setIsSavingSettings(true);
    try {
      // 1. Atualizar nome (apenas Dono)
      if (isOwner && trimmedName && trimmedName !== (room.name || serverName)) {
        const nameRes = await updateServerNameInSupabase(room.id, trimmedName);
        if (!nameRes.success) {
          notifyInChat(nameRes.message || 'Erro ao alterar o nome do servidor');
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

      notifyInChat('Servidor atualizado com sucesso!');
      setShowSettingsModal(false);
    } catch (err) {
      notifyInChat('Erro ao salvar alterações');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ─── GERENCIAMENTO DE CARGOS ─────────────────────────────────────────
  const handleSetRole = async (targetId: string, role: 'owner' | 'sub_owner' | 'member', targetName?: string) => {
    const name = targetName || 
      users.find(u => u.id === targetId)?.name || 
      serverMembers.find(m => m.id === targetId || m.username.trim().toLowerCase() === targetId.trim().toLowerCase())?.username;
    
    if (!name) return;

    // Se o usuário estiver online no socket, emitir atualização em tempo real
    const onlineUser = users.find(u => u.id === targetId || (u.name || '').trim().toLowerCase() === name.trim().toLowerCase());
    if (onlineUser && onSetUserRole) {
      onSetUserRole(onlineUser.id, role);
    }

    // Persistir papel no Supabase se for servidor permanente
    if (room?.id) {
      await updateMemberRoleInSupabase(room.id, name, role);
    }

    // Atualizar estado local de membros imediatamente
    setServerMembers((prev) =>
      prev.map((m) =>
        m.username.trim().toLowerCase() === name.trim().toLowerCase() ? { ...m, role } : m
      )
    );

    notifyInChat(`Cargo de ${name} atualizado para ${role === 'sub_owner' ? 'Sub Dono' : role === 'owner' ? 'Dono' : 'Membro'}`);
  };

  // ─── EXPULSÃO DA SALA / SERVIDOR ─────────────────────────────────────
  const handleKickUser = async (targetId: string, targetName: string, isOffline: boolean) => {
    // Se estiver online na sala, desconectar via socket
    if (!isOffline) {
      onAdminAction('kick_room', targetId);
    }

    // Se for servidor, remover membro do Supabase e da lista local
    if (isEffectiveServer && room?.id && targetName) {
      await leaveServerFromSupabase(room.id, targetName);
      setServerMembers((prev) =>
        prev.filter((m) => m.username.trim().toLowerCase() !== targetName.trim().toLowerCase())
      );
    }

    notifyInChat(`${targetName} foi expulso ${isEffectiveServer ? 'do servidor' : 'da sala'}.`);
  };

  // Resolução unificada de dados do usuário clicado (online ou offline)
  const targetUserInContextMenu = users.find(u => u.id === contextMenu?.targetId) ||
    (contextMenu?.targetName ? users.find(u => (u.name || '').trim().toLowerCase() === contextMenu.targetName?.trim().toLowerCase()) : undefined);

  const targetMemberEntry = serverMembers.find(m =>
    (contextMenu?.targetName && m.username.trim().toLowerCase() === contextMenu.targetName.trim().toLowerCase()) ||
    m.id === contextMenu?.targetId ||
    (targetUserInContextMenu?.name && m.username.trim().toLowerCase() === targetUserInContextMenu.name.trim().toLowerCase()) ||
    m.username.trim().toLowerCase() === (contextMenu?.targetId || '').trim().toLowerCase()
  );

  const targetDisplayName = targetUserInContextMenu?.name || targetMemberEntry?.username || contextMenu?.targetName || 'Anônimo';
  
  const isTargetOwner = 
    targetMemberEntry?.role === 'owner' || 
    (room?.adminIds?.includes(contextMenu?.targetId || '') && !room?.subOwnerIds?.includes(contextMenu?.targetId || '')) ||
    (Boolean(room?.ownerId) && room?.ownerId === contextMenu?.targetId);

  const isTargetSubOwner = 
    targetMemberEntry?.role === 'sub_owner' || 
    Boolean(room?.subOwnerIds?.includes(contextMenu?.targetId || ''));

  const isTargetOffline = Boolean(contextMenu?.isOffline || (!targetUserInContextMenu && targetMemberEntry));
  const canModerateTarget = isOwner ? !isTargetOwner : (isSubOwner && !isTargetOwner && !isTargetSubOwner);
  const isHomeView = activeRailContext === 'home' && (!room?.id || window.location.hash === '#/' || window.location.hash === '');

  return (
    <aside className={styles.sidebar}>
      {/* ── HEADER ── */}
      {isHomeView ? (
        <div className={styles.header}>
          <div className={styles.serverHeaderLeft}>
            <div className={styles.serverAvatarWrapper}>
              {!logoError ? (
                <img 
                  src="/logo.png" 
                  alt="" 
                  className={styles.serverAvatarImg} 
                  onError={() => setLogoError(true)}
                  style={{ objectFit: 'contain', padding: '2px', background: 'transparent' }} 
                />
              ) : (
                <div className={styles.serverAvatarFallback} style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                  <i className="fa-solid fa-compass" style={{ fontSize: '16px', color: '#fff' }} />
                </div>
              )}
              <span className={styles.serverOnlineBadge} />
            </div>
            <div className={styles.serverInfo}>
              <h1 className={styles.serverTitle}>
                <span>Hub Concord</span>
                <i className="fa-solid fa-compass" style={{ color: '#7c5cff', fontSize: '12px' }} />
              </h1>
              <p className={styles.serverSubtitle}>Início & Salas Rápidas</p>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      <div className={styles.sections}>
        {isHomeView ? (
          <>
            {/* ── ATALHOS RÁPIDOS DO HUB ── */}
            <section className={styles.section}>
              <div className={styles.sectionLabel}>
                <span>Navegação</span>
              </div>
              <div className={styles.channelList}>
                <button
                  className={`${styles.channelItem} ${homeTab === 'hub' ? styles.channelActive : ''}`}
                  onClick={() => {
                    setHomeTab('hub');
                    setActiveRailContext('home');
                    navigate('/');
                  }}
                >
                  <span className={styles.channelItemLeft}>
                    <i className="fa-solid fa-house" style={{ color: '#7c5cff' }} />
                    <span className={styles.channelName}>Central de Início</span>
                  </span>
                </button>

                <button
                  className={`${styles.channelItem} ${homeTab === 'friends' ? styles.channelActive : ''}`}
                  onClick={() => {
                    setHomeTab('friends');
                    setActiveRailContext('home');
                    navigate('/');
                  }}
                >
                  <span className={styles.channelItemLeft}>
                    <i className="fa-solid fa-user-group" style={{ color: '#818cf8' }} />
                    <span className={styles.channelName}>Amigos</span>
                  </span>
                  {friends.filter(f => f.status === 'pending').length > 0 && (
                    <span className={styles.badgeCount}>
                      {friends.filter(f => f.status === 'pending').length}
                    </span>
                  )}
                </button>

                <button
                  className={styles.channelItem}
                  onClick={() => setCreateRoomPromptOpen(true)}
                >
                  <span className={styles.channelItemLeft}>
                    <i className="fa-solid fa-bolt" style={{ color: '#10b981' }} />
                    <span className={styles.channelName}>Criar Sala (14h)</span>
                  </span>
                </button>

                <button
                  className={styles.channelItem}
                  onClick={() => openActionModal('create-server')}
                >
                  <span className={styles.channelItemLeft}>
                    <i className="fa-solid fa-plus-circle" style={{ color: '#a78bfa' }} />
                    <span className={styles.channelName}>Criar Servidor</span>
                  </span>
                </button>
              </div>
            </section>

            {/* ── SALAS TEMPORÁRIAS ATIVAS (14h) ── */}
            <section className={styles.section}>
              <div className={styles.sectionLabel}>
                <div className={styles.sectionLabelLeft}>
                  <i className="fa-solid fa-clock" style={{ fontSize: '11px', color: '#fbbf24' }} />
                  <span>Salas Ativas (14h)</span>
                </div>
                {recentRooms.length > 0 && <span className={styles.badgeCount}>{recentRooms.length}</span>}
              </div>
              <div className={styles.channelList}>
                {recentRooms.length === 0 ? (
                  <div style={{ padding: '12px 8px', fontSize: '12px', color: '#6b7280', textAlign: 'center' }}>
                    Nenhuma sala ativa
                  </div>
                ) : (
                  recentRooms.map((r) => (
                    <div key={r.id} className={styles.channelRow}>
                      <button
                        className={styles.channelItem}
                        onClick={() => {
                          setIsServer(false);
                          setActiveRailContext(r.id);
                          navigate(`/room/${r.id}?code=${r.code}`);
                        }}
                        title={`Entrar na sala #${r.code}`}
                      >
                        <span className={styles.channelItemLeft}>
                          <i className="fa-solid fa-door-open" style={{ color: '#fbbf24' }} />
                          <span className={styles.channelName}>{r.name}</span>
                        </span>
                        <span style={{ fontSize: '10px', color: '#fbbf24', marginLeft: 'auto', fontWeight: 600 }}>
                          {formatRoomTimeRemaining(r.expiresAt).replace(' restantes', '')}
                        </span>
                      </button>
                      <div className={styles.channelActions}>
                        <button
                          className={styles.channelActionBtn}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
                            const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
                            const link = `${baseUrl}/#/room/${r.id}?code=${r.code}`;
                            if ((window as any).electron?.copyToClipboard) {
                              (window as any).electron.copyToClipboard(link);
                            } else {
                              await navigator.clipboard.writeText(link);
                            }
                            toast.success('Link copiado!');
                          }}
                          title="Copiar link"
                        >
                          <i className="fa-regular fa-clone" />
                        </button>
                        <button
                          className={`${styles.channelActionBtn} ${styles.channelActionBtnDanger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecentRoom(r.id);
                            refreshRecentRooms();
                          }}
                          title="Remover do histórico"
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* ── MENSAGENS DIRETAS (DMs) ── */}
            <section className={styles.section}>
              <div className={styles.sectionLabel}>
                <div className={styles.sectionLabelLeft}>
                  <i className="fa-solid fa-message" style={{ fontSize: '11px', color: '#818cf8' }} />
                  <span>Mensagens Diretas</span>
                </div>
                {directChats.length > 0 && <span className={styles.badgeCount}>{directChats.length}</span>}
              </div>
              <div className={styles.channelList}>
                {directChats.length === 0 ? (
                  <div style={{ padding: '10px 8px', fontSize: '12px', color: '#6b7280', textAlign: 'center' }}>
                    Nenhuma conversa iniciada
                  </div>
                ) : (
                  directChats.map((chat) => {
                    const isDmActive = homeTab === 'dm' && activeDmChat?.id === chat.id;
                    const partnerName = chat.partnerName || (chat as any).other_user_name || 'Usuário';
                    const partnerAvatar = chat.partnerAvatarUrl || (chat as any).other_user_avatar;
                    return (
                      <div key={chat.id} className={styles.channelRow}>
                        <button
                          className={`${styles.channelItem} ${isDmActive ? styles.channelActive : ''}`}
                          onClick={() => {
                            setActiveDmChat(chat);
                            setHomeTab('dm');
                          }}
                          title={`Conversar com ${partnerName}`}
                        >
                          <span className={styles.channelItemLeft} style={{ gap: '8px' }}>
                            <div style={{ position: 'relative', width: 22, height: 22, flexShrink: 0 }}>
                              {partnerAvatar ? (
                                <img src={partnerAvatar} alt={partnerName} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#6366f1', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                  {partnerName.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <span className={styles.channelName}>{partnerName}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            {/* ── SEÇÃO DE CANAIS DE TEXTO ── */}
            <section className={styles.section}>
              <div className={styles.sectionLabel}>
                <div className={styles.sectionLabelLeft}>
                  <i className="fa-regular fa-comments" style={{ fontSize: '12px' }} />
                  <span>Canais de Texto</span>
                </div>
                {isEffectiveServer && canManageServer && (
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
                  {isEffectiveServer && !isGeral && (
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
            {isEffectiveServer && canManageServer && (
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
                voiceUsers.map((user, idx) => {
                  const mem = serverMembers.find(m => m.username.toLowerCase() === (user.name || '').toLowerCase());
                  const isUserOwner = isEffectiveServer
                    ? (mem?.role === 'owner' || user?.role === 'owner' || (Boolean(room?.ownerId) && (room?.ownerId === user.persistentId || room?.ownerId === user.id)))
                    : (Boolean(room?.adminIds?.includes(user.id) && !room?.subOwnerIds?.includes(user.id)));
                  const isUserSubOwner = isEffectiveServer
                    ? (!isUserOwner && (mem?.role === 'sub_owner' || user?.role === 'sub_owner' || Boolean(room?.subOwnerIds?.includes(user.id))))
                    : Boolean(room?.subOwnerIds?.includes(user.id));
                  const isCurrentUser = user.id === myId || (Boolean(user.name) && Boolean(myName) && user.name.trim().toLowerCase() === myName.trim().toLowerCase());
                  const userAvatar = user.avatarUrl || (isCurrentUser ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) || mem?.avatarUrl || null;
                  const userCustomRole = user.customRole || mem?.customRole || null;

                  return (
                    <UserCard
                      key={`voice-${user.id}-${idx}`}
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
                      customRole={userCustomRole}
                      onScreenShareClick={onScreenShareClick}
                      onContextMenu={(e, id, name, isOffline) => handleContextMenu(e, id, name, isOffline)}
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
              {onlineMembers.map((user, idx) => {
                const mem = serverMembers.find(m => m.username.toLowerCase() === (user.name || '').toLowerCase());
                const isUserOwner = isEffectiveServer
                  ? (mem?.role === 'owner' || user?.role === 'owner' || (Boolean(room?.ownerId) && (room?.ownerId === user.persistentId || room?.ownerId === user.id)))
                  : (Boolean(room?.adminIds?.includes(user.id) && !room?.subOwnerIds?.includes(user.id)));
                const isUserSubOwner = isEffectiveServer
                  ? (!isUserOwner && (mem?.role === 'sub_owner' || user?.role === 'sub_owner' || Boolean(room?.subOwnerIds?.includes(user.id))))
                  : Boolean(room?.subOwnerIds?.includes(user.id));
                const isCurrentUser = user.id === myId || (Boolean(user.name) && Boolean(myName) && user.name.trim().toLowerCase() === myName.trim().toLowerCase());
                const userAvatar = user.avatarUrl || (isCurrentUser ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) || mem?.avatarUrl || null;
                const userCustomRole = user.customRole || mem?.customRole || null;

                return (
                  <UserCard
                    key={`online-${user.id}-${idx}`}
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
                    customRole={userCustomRole}
                    onScreenShareClick={onScreenShareClick}
                    onContextMenu={(e, id, name, isOffline) => handleContextMenu(e, id, name, isOffline)}
                    onAvatarClick={(id, name, avatar, isOwner, isSubOwner, isMe) => {
                      const cleanMyTag = (myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', '');
                      openUserProfile({
                        id,
                        name,
                        avatarUrl: avatar,
                        role: isOwner ? 'owner' : isSubOwner ? 'sub_owner' : 'member',
                        isMe,
                        tag: isMe ? cleanMyTag : undefined,
                      });
                    }}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 3. USUÁRIOS OFFLINE (Apenas para Servidores) ── */}
        {isEffectiveServer && (
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
                  offlineMembers.map((member, idx) => (
                    <div 
                      key={`offline-${member.id || member.username}-${idx}`} 
                      className={styles.offlineUserItem}
                      onContextMenu={(e) => handleContextMenu(e, member.id, member.username, true)}
                    >
                      <div 
                        className={styles.avatarWrapper}
                        onClick={() => {
                          openUserProfile({
                            id: member.id,
                            name: member.username,
                            avatarUrl: member.avatarUrl,
                            role: member.role as any,
                            isMe: false,
                          });
                        }}
                        style={{ cursor: 'pointer' }}
                        title={`Ver perfil de ${member.username}`}
                      >
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
                      {member.customRole && (
                        <span 
                          className={styles.userRoleBadge} 
                          style={{
                            borderColor: member.customRole.color || '#7c5cff',
                            color: member.customRole.color || '#a78bfa',
                            background: `${member.customRole.color || '#7c5cff'}22`,
                          }}
                          title={`Cargo: ${member.customRole.name}`}
                        >
                          <span>{member.customRole.emoji}</span>
                          <span className={styles.userRoleBadgeText}>{member.customRole.name}</span>
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
          </>
        )}
      </div>

      {/* ── ACTIVE VOICE CALL FLOATING WIDGET (Apenas visível se estiver exatamente na sala/servidor da chamada) ── */}
      {(() => {
        const isCurrentCallRoom = inVoice && activeRailContext !== 'home' && (
          !activeCallInfo ||
          activeCallInfo.roomId === room?.id ||
          activeCallInfo.roomId === activeRailContext ||
          (activeCallInfo.code && (room?.code?.toUpperCase() === activeCallInfo.code.toUpperCase() || activeRailContext.toUpperCase() === activeCallInfo.code.toUpperCase()))
        );

        if (!isCurrentCallRoom) return null;

        return (
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
        );
      })()}

      {/* ── USER CONTROL BAR (FOOTER) ── */}
      <div className={styles.userControlFooter}>
        <div className={styles.userControlLeft}>
          <div 
            className={styles.myAvatarWrapper}
            onClick={() => {
              setProfileModalTab('profile');
              setShowProfileModal(true);
            }}
            style={{ cursor: 'pointer' }}
            title="Abrir configurações e perfil"
          >
            {effectiveMyAvatar && !avatarLoadError ? (
              <img 
                src={effectiveMyAvatar} 
                alt={myName} 
                className={styles.myAvatarImg} 
                onError={() => setAvatarLoadError(true)}
              />
            ) : (
              <div className={styles.myAvatarFallback}>
                {(myName ? myName.charAt(0).toUpperCase() : '?')}
              </div>
            )}
            <span className={styles.myStatusDot} />
          </div>

          <div 
            className={styles.myInfo}
            onClick={(e) => {
              e.stopPropagation();
              const cleanTag = (myTag || localStorage.getItem('concord_user_tag') || (myId ? myId.slice(0, 4).toUpperCase() : '7236')).replace('#', '');
              const userFullIdentifier = `${myName || 'Usuário'}#${cleanTag}`;
              if ((window as any).electron?.copyToClipboard) {
                (window as any).electron.copyToClipboard(userFullIdentifier);
              } else if (navigator.clipboard) {
                navigator.clipboard.writeText(userFullIdentifier);
              }
              setCopiedFooterUser(true);
              toast.success(`Usuário Copiado: ${userFullIdentifier}`, { id: 'user-id-copied' });
              setTimeout(() => setCopiedFooterUser(false), 2500);
            }}
            title="Clique para copiar seu usuário (ex: MISERA GAMES#7236)"
          >
            <div className={styles.myNameText}>{myName || 'Usuário'}</div>
            {copiedFooterUser ? (
              <span className={styles.copiedBadge}>
                <i className="fa-solid fa-check" /> Copiado!
              </span>
            ) : (
              <div className={styles.myTagText}>
                #{myTag || localStorage.getItem('concord_user_tag') || (myId ? myId.slice(0, 4).toUpperCase() : '7236')}
              </div>
            )}
          </div>
        </div>
        <div className={styles.userControlButtons}>
          <button 
            id="micToggleBtn"
            className={`${styles.controlBtn} ${micMuted ? styles.controlBtnDanger : ''}`}
            onClick={toggleMicMute}
            title={micMuted ? "Ativar Microfone" : "Mutar Microfone"}
            aria-label={micMuted ? "Ativar Microfone" : "Mutar Microfone"}
          >
            <i key={micMuted ? 'mic-off' : 'mic-on'} className={`fa-solid ${micMuted ? 'fa-microphone-slash' : 'fa-microphone'}`} style={{ fontSize: '13px' }} />
          </button>
          <button 
            id="deafenToggleBtn"
            className={`${styles.controlBtn} ${callMuted ? styles.controlBtnDanger : ''}`}
            onClick={toggleCallMute}
            title={callMuted ? "Ativar Áudio" : "Ensurdecer"}
            aria-label={callMuted ? "Ativar Áudio" : "Ensurdecer"}
          >
            <i key={callMuted ? 'deaf-on' : 'deaf-off'} className={`fa-solid ${callMuted ? 'fa-headphones-simple' : 'fa-headphones'}`} style={{ fontSize: '13px' }} />
          </button>
          <button 
            className={`${styles.controlBtn} ${styles.gearBtn}`}
            onClick={() => {
              setProfileModalTab('profile');
              setShowProfileModal(true);
            }}
            title="Configurações de Perfil e Servidor"
            aria-label="Configurações"
          >
            <i className="fa-solid fa-gear" style={{ fontSize: '13px' }} />
          </button>
        </div>
      </div>

      <div id="remote-audios" style={{ display: 'none' }} />

      {showProfileModal && (
        <ProfileModal 
          initialTab={profileModalTab}
          onClose={() => setShowProfileModal(false)}
          onUpdate={(newName, newAvatar) => {
            const prevName = myName;
            setMyName(newName);
            if (newAvatar !== undefined) {
              setMyAvatarUrl(newAvatar || null);
            }
            if (prevName && prevName.toLowerCase() !== newName.toLowerCase()) {
              if (room?.id) {
                removeLocalServerMember(room.id, prevName);
              }
              setServerMembers((prev) =>
                prev.map((m) =>
                  m.username.toLowerCase() === prevName.toLowerCase()
                    ? { ...m, username: newName, avatarUrl: newAvatar ?? m.avatarUrl }
                    : m
                )
              );
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
            <span>{targetDisplayName}</span>
            <span className={styles.contextMenuUserTag}>
              {isTargetOwner ? '👑 Dono' : isTargetSubOwner ? '🛡 Sub Dono' : '👤 Membro'}
            </span>
          </div>

          {/* Opção: Ver Perfil */}
          <button 
            className={styles.contextMenuItem}
            onClick={() => {
              const targetUserObj = users.find(u => u.id === contextMenu.targetId);
              const targetMember = serverMembers.find(m => m.username.toLowerCase() === (targetDisplayName || '').toLowerCase());
              const isCurrentUser = contextMenu.targetId === myId || (Boolean(targetDisplayName) && Boolean(myName) && targetDisplayName.trim().toLowerCase() === myName.trim().toLowerCase());
              const resolvedAvatar = targetUserObj?.avatarUrl || (isCurrentUser ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) || targetMember?.avatarUrl || null;

              openUserProfile({
                id: contextMenu.targetId,
                name: targetDisplayName || 'Usuário',
                avatarUrl: resolvedAvatar,
                role: isTargetOwner ? 'owner' : isTargetSubOwner ? 'sub_owner' : 'member',
                isMe: isCurrentUser,
                tag: isCurrentUser ? (myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', '') : undefined,
              });
              setContextMenu(null);
            }}
          >
            <i className="fa-solid fa-id-card" style={{ width: 14, color: '#7c5cff' }} />
            Ver Perfil
          </button>

          {/* Opção: Adicionar Amigo ou Pedido Pendente */}
          {(() => {
            const isCurrentUser = contextMenu.targetId === myId || (Boolean(targetDisplayName) && Boolean(myName) && targetDisplayName.trim().toLowerCase() === myName.trim().toLowerCase());
            if (isCurrentUser) return null;

            const targetMember = serverMembers.find(m => m.username.toLowerCase() === (targetDisplayName || '').toLowerCase());
            const targetName = (targetDisplayName || targetMember?.username || '').trim();
            const targetUid = targetMember?.user_id || contextMenu.targetId;

            const friendRel = friends.find(f => 
              (targetUid && (f.friendId === targetUid || f.userId === targetUid)) ||
              (targetName && (f.friendName?.trim().toLowerCase() === targetName.toLowerCase() || (f as any).userName?.trim().toLowerCase() === targetName.toLowerCase()))
            );

            if (friendRel?.status === 'accepted') {
              return null; // Já são amigos
            }

            if (friendRel?.status === 'pending') {
              return (
                <button
                  className={styles.contextMenuItem}
                  onClick={async () => {
                    setContextMenu(null);
                    try {
                      const ok = await cancelFriendRequestInSupabase(friendRel.id);
                      if (ok) {
                        toast.success('Solicitação de amizade cancelada.');
                        const updated = await fetchFriendsFromSupabase();
                        setFriends(updated);
                      } else {
                        toast.error('Erro ao cancelar solicitação.');
                      }
                    } catch {
                      toast.error('Erro ao cancelar solicitação.');
                    }
                  }}
                  title="Cancelar solicitação de amizade pendente"
                  style={{ color: '#f87171' }}
                >
                  <i className="fa-solid fa-user-xmark" style={{ width: 14, color: '#f87171' }} />
                  Cancelar Pedido
                </button>
              );
            }

            return (
              <button
                className={styles.contextMenuItem}
                onClick={async () => {
                  const candidateName = targetName;
                  const candidateId = isUuid(targetUid) ? targetUid : undefined;
                  setContextMenu(null);
                  if (!candidateName && !candidateId) return;

                  try {
                    const res = await sendFriendRequestToSupabase(candidateName, candidateId);
                    if (res.success) {
                      toast.success(res.message);
                      const updated = await fetchFriendsFromSupabase();
                      setFriends(updated);
                    } else {
                      toast.error(res.message);
                    }
                  } catch {
                    toast.error('Erro ao enviar pedido de amizade.');
                  }
                }}
              >
                <i className="fa-solid fa-user-plus" style={{ width: 14, color: '#10b981' }} />
                Adicionar Amigo
              </button>
            );
          })()}

          {/* Opção: Bloquear Usuário / Desbloquear Usuário */}
          {(() => {
            const isCurrentUser = contextMenu.targetId === myId || (Boolean(targetDisplayName) && Boolean(myName) && targetDisplayName.trim().toLowerCase() === myName.trim().toLowerCase());
            if (isCurrentUser) return null;

            const targetMember = serverMembers.find(m => m.username.toLowerCase() === (targetDisplayName || '').toLowerCase());
            const targetName = (targetDisplayName || targetMember?.username || '').trim();
            const targetUid = targetMember?.user_id || contextMenu.targetId;

            const isBlocked = friends.some(f => 
              f.status === 'blocked' && (
                (targetUid && (f.friendId === targetUid || f.userId === targetUid)) ||
                (targetName && (f.friendName?.trim().toLowerCase() === targetName.toLowerCase() || (f as any).userName?.trim().toLowerCase() === targetName.toLowerCase()))
              )
            );

            return (
              <button
                className={styles.contextMenuItem}
                onClick={async () => {
                  setContextMenu(null);
                  if (isBlocked) {
                    const match = friends.find(f => f.status === 'blocked' && ((targetUid && (f.friendId === targetUid || f.userId === targetUid)) || (targetName && f.friendName?.toLowerCase() === targetName.toLowerCase())));
                    if (match) {
                      await unblockUserInSupabase(match.id);
                      toast.success(`${targetName} foi desbloqueado.`);
                      const updated = await fetchFriendsFromSupabase();
                      setFriends(updated);
                    }
                  } else {
                    if (window.confirm(`Deseja bloquear ${targetName}?`)) {
                      await blockUserInSupabase(targetUid, targetName);
                      toast.success(`${targetName} foi bloqueado.`);
                      const updated = await fetchFriendsFromSupabase();
                      setFriends(updated);
                    }
                  }
                }}
              >
                <i className={`fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'}`} style={{ width: 14, color: isBlocked ? '#10b981' : '#ef4444' }} />
                {isBlocked ? 'Desbloquear Usuário' : 'Bloquear Usuário'}
              </button>
            );
          })()}

          <div className={styles.contextMenuDivider} />

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
          {isOwner && !isTargetOwner && (
            <>
              <div className={styles.contextMenuDivider} />
              {!isTargetSubOwner ? (
                <button 
                  className={styles.contextMenuItem}
                  onClick={() => {
                    handleSetRole(contextMenu.targetId, 'sub_owner', targetDisplayName);
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
                    handleSetRole(contextMenu.targetId, 'member', targetDisplayName);
                    setContextMenu(null);
                  }}
                >
                  <i className="fa-solid fa-user" style={{ width: 14 }} />
                  Rebaixar para Membro
                </button>
              )}
            </>
          )}

          {/* Gerenciar Cargos do Servidor (Nome + Emoji) */}
          {canManageServer && (
            <>
              <div className={styles.contextMenuDivider} />
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  const targetMember = serverMembers.find(m => m.username.toLowerCase() === (targetDisplayName || '').toLowerCase());
                  const targetOnlineUser = users.find(u => u.id === contextMenu.targetId || (u.name && u.name.toLowerCase() === (targetDisplayName || '').toLowerCase()));
                  setManageRoleTarget({
                    userId: contextMenu.targetId,
                    username: targetDisplayName || targetMember?.username || 'Membro',
                    avatarUrl: targetOnlineUser?.avatarUrl || targetMember?.avatarUrl || null,
                    customRole: targetOnlineUser?.customRole || targetMember?.customRole || null,
                  });
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-tags" style={{ width: 14, color: '#f59e0b' }} />
                Definir Cargo (Nome + Emoji)
              </button>
            </>
          )}

          {/* Ações de moderação (Dono + Sub Dono respeitando hierarquia) */}
          {canManageServer && canModerateTarget && (
            <>
              <div className={styles.contextMenuDivider} />
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  if (isTargetOffline) {
                    notifyInChat(`${targetDisplayName} está offline.`);
                  } else {
                    onAdminAction('mute', contextMenu.targetId);
                  }
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-microphone-slash" style={{ width: 14 }} />
                Silenciar no Servidor
              </button>
              <button 
                className={styles.contextMenuItem}
                onClick={() => {
                  if (isTargetOffline) {
                    notifyInChat(`${targetDisplayName} está offline.`);
                  } else {
                    onAdminAction('unmute', contextMenu.targetId);
                  }
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
                  if (isTargetOffline) {
                    notifyInChat(`${targetDisplayName} não está conectado a nenhuma chamada.`);
                  } else {
                    onAdminAction('kick_voice', contextMenu.targetId);
                  }
                  setContextMenu(null);
                }}
              >
                <i className="fa-solid fa-phone-slash" style={{ width: 14 }} />
                Desconectar da Call
              </button>
              <button 
                className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                onClick={() => {
                  handleKickUser(contextMenu.targetId, targetDisplayName, isTargetOffline);
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

      {/* ── MODAL: GERENCIAMENTO DE CARGOS (Nome + Emoji) ── */}
      {manageRoleTarget && (
        <ManageRolesModal
          isOpen={Boolean(manageRoleTarget)}
          onClose={() => setManageRoleTarget(null)}
          serverId={room?.id || ''}
          targetUserId={manageRoleTarget.userId}
          targetUsername={manageRoleTarget.username}
          targetAvatarUrl={manageRoleTarget.avatarUrl}
          currentCustomRole={manageRoleTarget.customRole}
          socketEmit={(_event, payload) => {
            if (onSetCustomRole) onSetCustomRole(payload);
          }}
          onRoleSaved={(role) => {
            setServerMembers((prev) =>
              prev.map((m) =>
                m.username.toLowerCase() === manageRoleTarget.username.toLowerCase() || m.id === manageRoleTarget.userId
                  ? { ...m, customRole: role }
                  : m
              )
            );
          }}
        />
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
  customRole?: CustomRole | null;
  onScreenShareClick: (userId: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string, name?: string, isOffline?: boolean) => void;
  onAvatarClick?: (id: string, name: string, avatarUrl: string | null, isOwner: boolean, isSubOwner: boolean, isMe: boolean) => void;
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
  customRole,
  onScreenShareClick,
  onContextMenu,
  onAvatarClick,
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
      onContextMenu={(e) => onContextMenu(e, id, name, false)}
    >
      <div className={styles.userCardLeft}>
        <div 
          className={styles.avatarWrapper}
          onClick={(e) => {
            e.stopPropagation();
            onAvatarClick?.(id, name, displayAvatar, isOwner, isSubOwner, isMe);
          }}
          style={{ cursor: 'pointer' }}
          title={`Ver perfil de ${name}`}
        >
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
            {customRole && (
              <span
                className={styles.userRoleBadge}
                style={{
                  borderColor: customRole.color || '#7c5cff',
                  color: customRole.color || '#a78bfa',
                  background: `${customRole.color || '#7c5cff'}22`,
                }}
                title={`Cargo: ${customRole.name}`}
              >
                <span>{customRole.emoji}</span>
                <span className={styles.userRoleBadgeText}>{customRole.name}</span>
              </span>
            )}
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
