import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { 
  formatRoomTimeRemaining, 
  removeRecentRoom, 
  createRoomInSupabase, 
  saveRecentRoom, 
  saveMyServer,
  joinServerInSupabase,
  findRoomInSupabase,
  getOrCreatePersistentId,
  fetchFriendsFromSupabase,
  sendFriendRequestToSupabase,
  cancelFriendRequestInSupabase,
  respondFriendRequestInSupabase,
  removeFriendFromSupabase,
  blockUserInSupabase,
  unblockUserInSupabase,
  getOrCreateDirectChatInSupabase,
  fetchDirectChatsFromSupabase,
  cleanDisplayName,
  type Friend
} from '../lib/supabase';
import toast from 'react-hot-toast';
import styles from './HomeHub.module.css';
import { SERVER_URL } from '../config';

export const HomeHub: React.FC = () => {
  const navigate = useNavigate();
  const { 
    myName, 
    myTag,
    recentRooms, 
    refreshRecentRooms, 
    openActionModal, 
    setActiveRailContext, 
    setIsServer, 
    setServerName,
    homeTab,
    setHomeTab,
    friendsFilter,
    setFriendsFilter,
    friends,
    setFriends,
    setDirectChats,
    setActiveDmChat,
    createRoomPromptOpen,
    setCreateRoomPromptOpen,
    servers,
    setServers,
    refreshServers,
    recordRecentServer,
    recentCallServers,
    refreshRecentCallServers,
    showConfirmModal,
  } = useAppStore();

  const [showAllServers, setShowAllServers] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [, setTick] = useState(0);

  // Modal para Criar Sala Rápida com nome
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [promptRoomName, setPromptRoomName] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Modal de Aviso de Migração e Escalabilidade
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);

  // Adicionar amigo input
  const [addFriendInput, setAddFriendInput] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  // Sync external create room prompt trigger
  useEffect(() => {
    if (createRoomPromptOpen) {
      setIsPromptModalOpen(true);
      setCreateRoomPromptOpen(false);
    }
  }, [createRoomPromptOpen, setCreateRoomPromptOpen]);

  // Update room time remaining badges every 60s
  useEffect(() => {
    refreshRecentRooms();
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      refreshRecentRooms();
    }, 60000);
    return () => clearInterval(timer);
  }, [refreshRecentRooms]);

  // Load saved servers via global store
  useEffect(() => {
    refreshServers();
    refreshRecentCallServers();
    const handleServersUpdated = (e: any) => {
      if (e.detail?.servers) {
        setServers(e.detail.servers);
      } else {
        refreshServers();
      }
    };
    const handleRecentCallUpdated = () => {
      refreshRecentCallServers();
    };
    window.addEventListener('concord:servers-updated', handleServersUpdated);
    window.addEventListener('concord:recent-call-servers-updated', handleRecentCallUpdated);
    return () => {
      window.removeEventListener('concord:servers-updated', handleServersUpdated);
      window.removeEventListener('concord:recent-call-servers-updated', handleRecentCallUpdated);
    };
  }, [refreshServers, setServers, refreshRecentCallServers]);

  // Load friends and direct chats
  const loadSocialData = useCallback(async () => {
    try {
      const [friendList, chatList] = await Promise.all([
        fetchFriendsFromSupabase(),
        fetchDirectChatsFromSupabase()
      ]);
      setFriends(friendList);
      setDirectChats(chatList);
    } catch {
      // Offline fallback
    }
  }, [setFriends, setDirectChats]);

  useEffect(() => {
    loadSocialData();
    const interval = setInterval(loadSocialData, 15000);
    const handleFriendsUpdated = () => {
      loadSocialData();
    };
    window.addEventListener('concord:friends-updated', handleFriendsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('concord:friends-updated', handleFriendsUpdated);
    };
  }, [loadSocialData]);

  // ─── CONEXÃO RÁPIDA INLINE ─────────────────────────────────────────
  const handleQuickConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = quickInput.trim();
    if (!raw) return;

    setConnecting(true);
    try {
      let targetCode = raw;
      let targetId: string | null = null;

      const codeMatch = raw.match(/[?&]code=([a-zA-Z0-9_-]+)/i);
      if (codeMatch) {
        targetCode = codeMatch[1].toUpperCase();
      } else {
        const inviteMatch = raw.match(/c[óo]digo(?:\s+de\s+convite)?[:\s]+([a-zA-Z0-9_-]+)/i);
        if (inviteMatch) {
          targetCode = inviteMatch[1].toUpperCase();
        } else if (!raw.includes('://') && !raw.includes('/')) {
          targetCode = raw.toUpperCase();
        }
      }

      const roomMatch = raw.match(/\/room\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-zA-Z0-9_-]+)/i);
      if (roomMatch) {
        targetId = roomMatch[1];
      }

      const dbRoom = await findRoomInSupabase(targetCode) || (targetId ? await findRoomInSupabase(targetId) : null);
      if (!dbRoom) {
        toast.error('Código de convite inválido ou expirado.');
        setConnecting(false);
        return;
      }

      const roomId = dbRoom.id;
      const roomCode = dbRoom.code;
      const isServer = Boolean(dbRoom.is_server || roomCode.startsWith('SRV-'));

      if (isServer) {
        await joinServerInSupabase(roomId);
        const srv = {
          id: roomId,
          code: roomCode,
          name: dbRoom.name,
          icon_url: dbRoom.icon_url,
          role: 'member' as const,
        };
        saveMyServer(srv);
        recordRecentServer(srv);
        await refreshServers();
      }

      setIsServer(isServer);
      if (dbRoom.name) setServerName(dbRoom.name);
      setActiveRailContext(roomId);
      navigate(`/room/${roomId}?code=${roomCode}${isServer ? '&server=1' : ''}`);
    } catch {
      toast.error('Código de convite inválido ou expirado.');
    } finally {
      setConnecting(false);
    }
  };

  // ─── CRIAR SALA RÁPIDA (14h) COM PROMPT ───────────────────────────
  const handleOpenRoomPrompt = () => {
    setPromptRoomName(`Sala de ${myName || 'Concord'}`);
    setIsPromptModalOpen(true);
  };

  const handleExecuteCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalRoomName = promptRoomName.trim() || `Sala de ${myName || 'Concord'}`;
    setIsCreatingRoom(true);

    try {
      const persistentId = getOrCreatePersistentId();
      const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const roomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persistentId,
          code: generatedCode,
          id: roomId,
          isServer: false,
          name: finalRoomName,
        }),
      }).catch(() => {});

      createRoomInSupabase(finalRoomName, generatedCode, roomId).catch(() => {});

      saveRecentRoom({
        id: roomId,
        code: generatedCode,
        name: finalRoomName,
        createdAt: Date.now(),
      });
      refreshRecentRooms();

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
      const inviteUrl = `${baseUrl}/#/room/${roomId}?code=${generatedCode}`;
      const inviteMessage = `Você foi convidado para a sala ${finalRoomName} no Concord (válida por 14h)! Acesse:\n${inviteUrl}`;

      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(inviteMessage);
        } else {
          await navigator.clipboard.writeText(inviteMessage);
        }
        toast.success('Sala criada e link de convite copiado!');
      } catch {
        toast.success('Sala criada com sucesso!');
      }

      setIsServer(false);
      setActiveRailContext(roomId);
      setIsPromptModalOpen(false);
      navigate(`/room/${roomId}?code=${generatedCode}`);
    } catch {
      toast.error('Erro ao gerar sala rápida.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // ─── AÇÕES DE AMIZADE ─────────────────────────────────────────────
  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = addFriendInput.trim();
    if (!query) return;

    setIsAddingFriend(true);
    try {
      const res = await sendFriendRequestToSupabase(query);
      if (res.success) {
        toast.success(res.message);
        setAddFriendInput('');
        loadSocialData();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error('Falha ao enviar solicitação de amizade.');
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleRespondFriend = async (friendshipId: string, status: 'accepted' | 'declined') => {
    try {
      const ok = await respondFriendRequestInSupabase(friendshipId, status === 'accepted');
      if (ok) {
        toast.success(status === 'accepted' ? 'Amizade aceita!' : 'Solicitação recusada.');
        loadSocialData();
      }
    } catch {
      toast.error('Erro ao processar solicitação.');
    }
  };

  const handleRemoveFriend = (friendshipId: string, name: string) => {
    showConfirmModal({
      title: 'Remover Amigo',
      message: `Tem certeza que deseja remover ${name} da sua lista de amigos?`,
      subMessage: 'Vocês deixarão de ver o status mútuo online.',
      confirmText: 'Remover',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          const ok = await removeFriendFromSupabase(friendshipId);
          if (ok) {
            toast('Amigo removido.', { icon: '🗑️' });
            loadSocialData();
          }
        } catch {
          toast.error('Erro ao remover amigo.');
        }
      },
    });
  };

  const handleBlockUser = (userId: string, name: string) => {
    showConfirmModal({
      title: 'Bloquear Usuário',
      message: `Tem certeza que deseja bloquear ${name}?`,
      subMessage: 'Este usuário não poderá mais lhe enviar mensagens ou solicitações.',
      confirmText: 'Bloquear',
      cancelText: 'Cancelar',
      isDanger: true,
      onConfirm: async () => {
        try {
          const ok = await blockUserInSupabase(userId);
          if (ok) {
            toast.success(`${name} foi bloqueado.`);
            loadSocialData();
          }
        } catch {
          toast.error('Erro ao bloquear usuário.');
        }
      },
    });
  };

  const handleUnblockUser = async (friendshipId: string) => {
    try {
      const ok = await unblockUserInSupabase(friendshipId);
      if (ok) {
        toast.success('Usuário desbloqueado.');
        loadSocialData();
      }
    } catch {
      toast.error('Erro ao desbloquear usuário.');
    }
  };

  const handleStartDm = async (friend: Friend) => {
    try {
      const targetId = friend.friendId || friend.userId;
      const chat = await getOrCreateDirectChatInSupabase(targetId);
      if (chat) {
        setActiveDmChat(chat);
        setHomeTab('dm');
      } else {
        toast.error('Não foi possível abrir a mensagem direta.');
      }
    } catch {
      toast.error('Erro ao iniciar conversa privada.');
    }
  };

  // ─── AÇÕES DE SALAS RECENTES ──────────────────────────────────────
  const handleJoinRecentRoom = (room: { id: string; code: string }) => {
    setIsServer(false);
    setActiveRailContext(room.id);
    navigate(`/room/${room.id}?code=${room.code}`);
  };

  const handleCopyRoomLink = async (e: React.MouseEvent, room: { id: string; code: string; name?: string }) => {
    e.stopPropagation();
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
    const link = `${baseUrl}/#/room/${room.id}?code=${room.code}`;
    try {
      if ((window as any).electron?.copyToClipboard) {
        (window as any).electron.copyToClipboard(link);
      } else {
        await navigator.clipboard.writeText(link);
      }
      toast.success('Link da sala copiado!');
    } catch {
      toast.error('Falha ao copiar link.');
    }
  };

  const handleRemoveRoom = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeRecentRoom(id);
    refreshRecentRooms();
    toast('Sala removida do seu histórico.', { icon: '🗑️' });
  };

  const initials = (name: string) => {
    const clean = (name || '').trim();
    if (!clean) return 'SR';
    const words = clean.split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  };

  // Filtering friends
  const onlineFriends = friends.filter(f => f.status === 'accepted' && (f.onlineStatus === 'online' || (f as any).online));
  const allFriends = friends.filter(f => f.status === 'accepted');
  const pendingFriends = friends.filter(f => f.status === 'pending');
  const incomingPending = pendingFriends.filter(f => Boolean(f.isIncomingRequest ?? (f as any).is_incoming));
  const outgoingPending = pendingFriends.filter(f => !f.isIncomingRequest && !(f as any).is_incoming);
  const blockedFriends = friends.filter(f => f.status === 'blocked');

  return (
    <div className={styles.container}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      {/* ── SEÇÃO: GERENCIADOR DE AMIGOS (DISCORD STYLE) ── */}
      {homeTab === 'friends' ? (
        <div className={styles.friendsContainer}>
          <div className={styles.friendsHeader}>
            <div className={styles.friendsTabs}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '12px', fontWeight: 700, fontSize: '15px' }}>
                <i className="fa-solid fa-user-group" style={{ color: '#818cf8' }} />
                <span>Amigos</span>
              </div>
              <button
                className={`${styles.tabBtn} ${friendsFilter === 'online' ? styles.tabBtnActive : ''}`}
                onClick={() => setFriendsFilter('online')}
              >
                Disponível ({onlineFriends.length})
              </button>
              <button
                className={`${styles.tabBtn} ${friendsFilter === 'all' ? styles.tabBtnActive : ''}`}
                onClick={() => setFriendsFilter('all')}
              >
                Todos ({allFriends.length})
              </button>
              <button
                className={`${styles.tabBtn} ${friendsFilter === 'pending' ? styles.tabBtnActive : ''}`}
                onClick={() => setFriendsFilter('pending')}
              >
                Pendentes
                {pendingFriends.length > 0 && (
                  <span className={`${styles.tabBadge} ${incomingPending.length > 0 ? styles.tabBadgeIncoming : ''}`}>
                    {incomingPending.length > 0 ? incomingPending.length : pendingFriends.length}
                  </span>
                )}
              </button>
              <button
                className={`${styles.tabBtn} ${friendsFilter === 'blocked' ? styles.tabBtnActive : ''}`}
                onClick={() => setFriendsFilter('blocked')}
              >
                Bloqueados ({blockedFriends.length})
              </button>
            </div>
            <button
              className={`${styles.addFriendTabBtn} ${friendsFilter === 'add' ? styles.addFriendActive : ''}`}
              onClick={() => setFriendsFilter('add')}
            >
              <i className="fa-solid fa-user-plus" style={{ marginRight: '6px' }} />
              Adicionar Amigo
            </button>
          </div>

          {/* Sub-view: Adicionar Amigo */}
          {friendsFilter === 'add' && (
            <div className={styles.addFriendSection}>
              <h2 className={styles.addFriendTitle}>ADICIONAR AMIGO</h2>
              <p className={styles.addFriendSubtitle}>
                Você pode adicionar amigos através do nome e tag única do Concord (ex.: <strong>Nome#{myTag || '0000'}</strong>) ou pelo ID de usuário.
              </p>
              <form onSubmit={handleSendFriendRequest} className={styles.addFriendInputBox}>
                <input
                  type="text"
                  className={styles.addFriendInput}
                  placeholder="Insira um Nome#0000 ou ID de usuário"
                  value={addFriendInput}
                  onChange={(e) => setAddFriendInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className={styles.addFriendSubmitBtn}
                  disabled={isAddingFriend || !addFriendInput.trim()}
                >
                  {isAddingFriend ? 'Enviando...' : 'Enviar Pedido de Amizade'}
                </button>
              </form>
            </div>
          )}

          {/* Sub-view: ABA PENDENTES (SEPARANDO RECEBIDOS E ENVIADOS) */}
          {friendsFilter === 'pending' && (
            <div className={styles.friendsList}>
              {pendingFriends.length === 0 ? (
                <div className={styles.emptyFriends}>
                  <i className={`fa-regular fa-clock ${styles.emptyFriendsIcon}`} />
                  <p>Nenhuma solicitação de amizade pendente.</p>
                </div>
              ) : (
                <div className={styles.pendingSectionsWrapper}>
                  {/* 1. SEÇÃO DE PEDIDOS RECEBIDOS */}
                  {incomingPending.length > 0 && (
                    <div className={styles.pendingSectionBlock}>
                      <div className={styles.pendingSectionHeader}>
                        <i className="fa-solid fa-inbox" style={{ color: '#10b981' }} />
                        <span>SOLICITAÇÕES RECEBIDAS — {incomingPending.length}</span>
                      </div>
                      <div className={styles.pendingList}>
                        {incomingPending.map((friend) => {
                          const rawName = friend.friendName || (friend as any).name || 'Amigo';
                          const fName = cleanDisplayName(rawName);
                          const fAvatar = friend.friendAvatarUrl || (friend as any).avatar_url;
                          const fTag = String(friend.friendTag || (friend as any).tag || '0000').replace('#', '');

                          return (
                            <div key={friend.id} className={`${styles.friendRow} ${styles.incomingFriendRow}`}>
                              <div className={styles.friendInfoLeft}>
                                <div className={styles.friendAvatarWrapper}>
                                  {fAvatar ? (
                                    <img src={fAvatar} alt={fName} className={styles.friendAvatarImg} />
                                  ) : (
                                    <div className={styles.friendAvatarFallback}>
                                      {fName.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <span className={`${styles.friendStatusDot} ${styles.dotOnline}`} />
                                </div>
                                <div className={styles.friendNameTag}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className={styles.friendName}>{fName}</span>
                                    <span className={styles.incomingBadgeTag}>#{fTag}</span>
                                  </div>
                                  <span className={styles.incomingHintText}>
                                    Quer ser seu amigo no Concord
                                  </span>
                                </div>
                              </div>

                              <div className={styles.friendActions}>
                                <button
                                  className={styles.acceptButtonFull}
                                  onClick={() => handleRespondFriend(friend.id, 'accepted')}
                                  title="Aceitar Pedido de Amizade"
                                >
                                  <i className="fa-solid fa-check" />
                                  <span>Aceitar</span>
                                </button>
                                <button
                                  className={styles.declineButtonFull}
                                  onClick={() => handleRespondFriend(friend.id, 'declined')}
                                  title="Recusar Pedido de Amizade"
                                >
                                  <i className="fa-solid fa-xmark" />
                                  <span>Recusar</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2. SEÇÃO DE PEDIDOS ENVIADOS */}
                  {outgoingPending.length > 0 && (
                    <div className={styles.pendingSectionBlock}>
                      <div className={styles.pendingSectionHeader}>
                        <i className="fa-regular fa-paper-plane" style={{ color: '#94a3b8' }} />
                        <span>SOLICITAÇÕES ENVIADAS — {outgoingPending.length}</span>
                      </div>
                      <div className={styles.pendingList}>
                        {outgoingPending.map((friend) => {
                          const rawName = friend.friendName || (friend as any).name || 'Amigo';
                          const fName = cleanDisplayName(rawName);
                          const fAvatar = friend.friendAvatarUrl || (friend as any).avatar_url;
                          const fTag = String(friend.friendTag || (friend as any).tag || '0000').replace('#', '');

                          return (
                            <div key={friend.id} className={styles.friendRow}>
                              <div className={styles.friendInfoLeft}>
                                <div className={styles.friendAvatarWrapper}>
                                  {fAvatar ? (
                                    <img src={fAvatar} alt={fName} className={styles.friendAvatarImg} />
                                  ) : (
                                    <div className={styles.friendAvatarFallback}>
                                      {fName.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <span className={`${styles.friendStatusDot} ${styles.dotOffline}`} />
                                </div>
                                <div className={styles.friendNameTag}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className={styles.friendName}>{fName}</span>
                                    <span className={styles.friendTag}>#{fTag}</span>
                                  </div>
                                  <span className={styles.friendTag}>
                                    Solicitação enviada • Aguardando resposta
                                  </span>
                                </div>
                              </div>

                              <div className={styles.friendActions}>
                                <button
                                  className={styles.cancelButtonFull}
                                  onClick={async () => {
                                    const ok = await cancelFriendRequestInSupabase(friend.id);
                                    if (ok) {
                                      toast.success('Solicitação de amizade cancelada.');
                                      loadSocialData();
                                    } else {
                                      toast.error('Erro ao cancelar solicitação.');
                                    }
                                  }}
                                  title="Cancelar Pedido de Amizade"
                                >
                                  <i className="fa-solid fa-xmark" />
                                  <span>Cancelar Pedido</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sub-view: Outras Listas (Online, Todos, Bloqueados) */}
          {friendsFilter !== 'add' && friendsFilter !== 'pending' && (
            <div className={styles.friendsList}>
              {friendsFilter === 'online' && onlineFriends.length === 0 && (
                <div className={styles.emptyFriends}>
                  <i className={`fa-solid fa-ghost ${styles.emptyFriendsIcon}`} />
                  <p>Nenhum amigo online no momento.</p>
                </div>
              )}
              {friendsFilter === 'all' && allFriends.length === 0 && (
                <div className={styles.emptyFriends}>
                  <i className={`fa-solid fa-user-plus ${styles.emptyFriendsIcon}`} />
                  <p>Você ainda não tem nenhum amigo adicionado.</p>
                  <button className={styles.addFriendTabBtn} onClick={() => setFriendsFilter('add')}>
                    Adicionar seu primeiro amigo
                  </button>
                </div>
              )}
              {friendsFilter === 'blocked' && blockedFriends.length === 0 && (
                <div className={styles.emptyFriends}>
                  <i className={`fa-solid fa-shield-halved ${styles.emptyFriendsIcon}`} />
                  <p>Você não possui usuários bloqueados.</p>
                </div>
              )}

              {/* Render rows */}
              {(friendsFilter === 'online' ? onlineFriends :
                friendsFilter === 'all' ? allFriends :
                blockedFriends).map((friend) => {
                const rawName = friend.friendName || (friend as any).name || 'Amigo';
                const fName = cleanDisplayName(rawName);
                const fAvatar = friend.friendAvatarUrl || (friend as any).avatar_url;
                const fTag = String(friend.friendTag || (friend as any).tag || '0000').replace('#', '');
                const fOnline = friend.onlineStatus === 'online' || (friend as any).online;
                const fTargetId = friend.friendId || friend.userId || (friend as any).user_id;

                return (
                  <div key={friend.id} className={styles.friendRow}>
                    <div className={styles.friendInfoLeft}>
                      <div className={styles.friendAvatarWrapper}>
                        {fAvatar ? (
                          <img src={fAvatar} alt={fName} className={styles.friendAvatarImg} />
                        ) : (
                          <div className={styles.friendAvatarFallback}>
                            {fName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className={`${styles.friendStatusDot} ${fOnline ? styles.dotOnline : styles.dotOffline}`} />
                      </div>
                      <div className={styles.friendNameTag}>
                        <span className={styles.friendName}>{fName}</span>
                        <span className={styles.friendTag}>
                          #{fTag} • {fOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </div>

                    <div className={styles.friendActions}>
                      {friend.status === 'accepted' && (
                        <>
                          <button
                            className={styles.actionIconBtn}
                            onClick={() => handleStartDm(friend)}
                            title="Enviar Mensagem Direta"
                          >
                            <i className="fa-solid fa-message" />
                          </button>
                          <button
                            className={`${styles.actionIconBtn} ${styles.actionIconBtnDanger}`}
                            onClick={() => handleRemoveFriend(friend.id, fName)}
                            title="Remover Amigo"
                          >
                            <i className="fa-solid fa-user-xmark" />
                          </button>
                          <button
                            className={`${styles.actionIconBtn} ${styles.actionIconBtnDanger}`}
                            onClick={() => handleBlockUser(fTargetId, fName)}
                            title="Bloquear Usuário"
                          >
                            <i className="fa-solid fa-ban" />
                          </button>
                        </>
                      )}

                      {friend.status === 'blocked' && (
                        <button
                          className={`${styles.actionIconBtn} ${styles.actionIconBtnSuccess}`}
                          onClick={() => handleUnblockUser(friend.id)}
                          title="Desbloquear"
                        >
                          <i className="fa-solid fa-lock-open" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ── SEÇÃO: HUB CENTRAL COM SALAS RÁPIDAS E SERVIDORES ── */
        <>
          {/* ── 1. CABEÇALHO HERO COM BARRA DE CONEXÃO RÁPIDA ── */}
          <div className={styles.hero}>
            <div className={styles.heroLeft}>
              <h1 className={styles.heroGreeting}>
                <span>Olá,</span>
                <span className={styles.heroName}>{myName || 'Concordiano'}</span>
                <span>👋</span>
              </h1>
              <p className={styles.heroSub}>
                Conecte-se instantaneamente aos seus servidores ou crie chamadas de alta fidelidade sem fricção.
              </p>
            </div>

            <form onSubmit={handleQuickConnect} className={styles.quickConnectBox}>
              <i className={`fa-solid fa-link ${styles.quickConnectIcon}`} />
              <input
                type="text"
                className={styles.quickConnectInput}
                placeholder="Cole um link ou código de sala/servidor..."
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
              />
              <button type="submit" className={styles.quickConnectBtn} disabled={connecting || !quickInput.trim()}>
                {connecting ? <i className="fa-solid fa-spinner fa-spin" /> : 'Conectar'}
              </button>
            </form>
          </div>

          {/* ── 2. AÇÕES DE 1 CLIQUE EM DESTAQUE ── */}
          <div className={styles.actionsBar}>
            <div className={`${styles.actionCard} ${styles.actionCardPrimary}`} onClick={handleOpenRoomPrompt}>
              <div className={styles.actionCardContent}>
                <div className={`${styles.actionIconWrapper} ${styles.actionIconWrapperSuccess}`}>
                  <i className="fa-solid fa-bolt" />
                </div>
                <div className={styles.actionInfo}>
                  <span className={styles.actionTitle}>Criar Sala Rápida (14h)</span>
                  <span className={styles.actionSub}>Entrada imediata com áudio HD, tela e YouTube</span>
                </div>
              </div>
              <span className={styles.actionArrow}>→</span>
            </div>

            <div className={styles.actionCard} onClick={() => openActionModal('create-server')}>
              <div className={styles.actionCardContent}>
                <div className={styles.actionIconWrapper}>
                  <i className="fa-solid fa-plus" />
                </div>
                <div className={styles.actionInfo}>
                  <span className={styles.actionTitle}>Criar Servidor</span>
                  <span className={styles.actionSub}>Comunidade permanente com múltiplos canais e membros</span>
                </div>
              </div>
              <span className={styles.actionArrow}>→</span>
            </div>
          </div>

          {/* ── 3. SALAS TEMPORÁRIAS ATIVAS (14h) ── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <i className="fa-solid fa-clock" style={{ color: '#fbbf24', fontSize: '16px' }} />
                <span>Salas Rápidas Ativas (14h)</span>
                {recentRooms.length > 0 && <span className={styles.badgeCount}>{recentRooms.length}</span>}
              </h2>
            </div>

            {recentRooms.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="fa-regular fa-clock" style={{ fontSize: '24px' }} />
                <span>Você não possui salas temporárias ativas no momento.</span>
              </div>
            ) : (
              <div className={styles.grid}>
                {recentRooms.map((room) => (
                  <div key={room.id} className={styles.roomCard}>
                    <div className={styles.roomCardTop}>
                      <div className={styles.roomCardInfo}>
                        <span className={styles.roomName}>{room.name}</span>
                        <span className={styles.roomCodeTag}>#{room.code}</span>
                      </div>
                      <div className={styles.timeBadge} title="Tempo até expirar">
                        <i className="fa-regular fa-hourglass-half" />
                        <span>{formatRoomTimeRemaining(room.expiresAt)}</span>
                      </div>
                    </div>

                    <div className={styles.roomCardFooter}>
                      <button className={styles.joinBtn} onClick={() => handleJoinRecentRoom(room)}>
                        <i className="fa-solid fa-arrow-right-to-bracket" />
                        <span>Entrar</span>
                      </button>
                      <button
                        className={styles.iconBtn}
                        onClick={(e) => handleCopyRoomLink(e, room)}
                        title="Copiar Link de Convite"
                      >
                        <i className="fa-regular fa-clone" />
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.deleteBtn}`}
                        onClick={(e) => handleRemoveRoom(e, room.id)}
                        title="Remover Sala"
                      >
                        <i className="fa-regular fa-trash-can" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 4. SERVIDORES RECENTES (Últimos 2 que esteve em call) ── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <i className="fa-solid fa-clock-rotate-left" style={{ color: '#818cf8', fontSize: '16px' }} />
                <span>Servidores Recentes</span>
                {recentCallServers.length > 0 && (
                  <span className={styles.badgeCount}>
                    {recentCallServers.slice(0, 2).length}
                  </span>
                )}
              </h2>
            </div>

            {recentCallServers.length > 0 ? (
              <div className={styles.grid}>
                {recentCallServers.slice(0, 2).map((server) => (
                  <div
                    key={`recent-call-${server.id}`}
                    className={`${styles.serverCard} ${styles.recentServerCard}`}
                    onClick={() => {
                      recordRecentServer(server);
                      setIsServer(true);
                      setServerName(server.name);
                      setActiveRailContext(server.id);
                      navigate(`/room/${server.id}?code=${server.code}&server=1`);
                    }}
                  >
                    <div className={styles.serverAvatar}>
                      {server.icon_url ? (
                        <img src={server.icon_url} alt={server.name} className={styles.serverAvatarImg} />
                      ) : (
                        <span>{initials(server.name)}</span>
                      )}
                    </div>
                    <div className={styles.serverDetails}>
                      <span className={styles.serverName}>{server.name}</span>
                      <span className={styles.serverRoleBadge}>
                        <i className="fa-solid fa-headphones" />
                        <span>Chamada Recente</span>
                      </span>
                    </div>
                    <span className={styles.actionArrow}>→</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <i className="fa-solid fa-server" style={{ fontSize: '24px' }} />
                <span>Você ainda não participou de nenhuma chamada em servidores recentemente.</span>
              </div>
            )}
          </section>

          {/* ── 5. MEUS SERVIDORES (Até 4 + Ver todos) ── */}
          {servers.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>
                  <i className="fa-solid fa-server" style={{ color: '#a78bfa', fontSize: '16px' }} />
                  <span>Meus Servidores</span>
                  <span className={styles.badgeCount}>{servers.length}</span>
                </h2>
                {servers.length > 4 && (
                  <button
                    type="button"
                    className={styles.viewAllToggleBtn}
                    onClick={() => setShowAllServers((prev) => !prev)}
                    title={showAllServers ? 'Recolher lista de servidores' : 'Ver todos os servidores'}
                  >
                    <span>{showAllServers ? 'Mostrar menos' : `Ver todos (${servers.length})`}</span>
                    <i className={`fa-solid ${showAllServers ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                  </button>
                )}
              </div>

              <div className={styles.grid}>
                {(showAllServers ? servers : servers.slice(0, 4)).map((server) => (
                  <div
                    key={server.id}
                    className={styles.serverCard}
                    onClick={() => {
                      recordRecentServer(server);
                      setIsServer(true);
                      setServerName(server.name);
                      setActiveRailContext(server.id);
                      navigate(`/room/${server.id}?code=${server.code}&server=1`);
                    }}
                  >
                    <div className={styles.serverAvatar}>
                      {server.icon_url ? (
                        <img src={server.icon_url} alt={server.name} className={styles.serverAvatarImg} />
                      ) : (
                        <span>{initials(server.name)}</span>
                      )}
                    </div>
                    <div className={styles.serverDetails}>
                      <span className={styles.serverName}>{server.name}</span>
                      <span className={styles.serverRoleBadge}>
                        <i className={server.role === 'owner' ? 'fa-solid fa-crown' : 'fa-solid fa-user'} />
                        <span>{server.role === 'owner' ? 'Dono' : 'Membro'}</span>
                      </span>
                    </div>
                    <span className={styles.actionArrow}>→</span>
                  </div>
                ))}
              </div>

              {servers.length > 4 && (
                <div className={styles.viewAllFooter}>
                  <button
                    type="button"
                    className={styles.viewAllExpandBtn}
                    onClick={() => setShowAllServers((prev) => !prev)}
                  >
                    <i className={`fa-solid ${showAllServers ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
                    <span>{showAllServers ? 'Mostrar menos servidores' : `Ver todos os servidores (${servers.length})`}</span>
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ── MODAL PROMPT: CRIAR SALA RÁPIDA (14h) ── */}
      {isPromptModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsPromptModalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalIcon}>
                <i className="fa-solid fa-bolt" />
              </div>
              <h3 className={styles.modalTitle}>Criar Sala Rápida (14h)</h3>
            </div>
            <p className={styles.modalDesc}>
              Sua sala efêmera ficará ativa por 14 horas e permite áudio HD, compartilhamento de tela e streaming em grupo.
            </p>
            <form onSubmit={handleExecuteCreateRoom}>
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>Nome da Sala</label>
                <input
                  type="text"
                  className={styles.modalInput}
                  placeholder={`Sala de ${myName || 'Concord'}`}
                  value={promptRoomName}
                  onChange={(e) => setPromptRoomName(e.target.value)}
                  maxLength={40}
                  autoFocus
                />
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setIsPromptModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={styles.confirmBtn}
                  disabled={isCreatingRoom}
                >
                  {isCreatingRoom ? 'Criando...' : 'Criar Sala'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── BOTÃO FLUTUANTE DE ATENÇÃO (MIGRAÇÃO & ESCALABILIDADE) ── */}
      <div
        className={styles.floatingAlertBtn}
        onClick={() => setIsMigrationModalOpen(true)}
        role="button"
        tabIndex={0}
        title="Aviso de Migração e Escalabilidade"
      >
        <div className={styles.floatingAlertBadge} />
        <i className={`fa-solid fa-triangle-exclamation ${styles.floatingAlertIcon}`} />
        <span className={styles.floatingAlertTooltip}>
          Aviso Importante: Migração em Breve ⚠️
        </span>
      </div>

      {/* ── MODAL: AVISO DE MIGRAÇÃO E ESCALABILIDADE ── */}
      {isMigrationModalOpen && createPortal(
        <div
          className={styles.migrationOverlay}
          onClick={() => setIsMigrationModalOpen(false)}
        >
          <div
            className={styles.migrationModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className={styles.migrationHeader}>
              <div className={styles.migrationHeaderLeft}>
                <div className={styles.migrationIconWrapper}>
                  <i className="fa-solid fa-triangle-exclamation" />
                </div>
                <div className={styles.migrationTitleWrap}>
                  <h3 className={styles.migrationTitle}>Aviso de Migração</h3>
                  <span className={styles.migrationSubtitle}>Atualização de Infraestrutura • Concord</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.migrationCloseBtn}
                onClick={() => setIsMigrationModalOpen(false)}
                title="Fechar"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            {/* Body Content */}
            <div className={styles.migrationBody}>
              {/* Card 1: Escalabilidade */}
              <div className={styles.migrationSectionCard}>
                <div className={styles.migrationSectionHeader}>
                  <i className="fa-solid fa-server" />
                  <span>Migração Importante para Escalabilidade</span>
                </div>
                <p className={styles.migrationText}>
                  Nos próximos dias, passaremos por uma migração importante no projeto Concord, focada na expansão da capacidade e infraestrutura dos nossos servidores. Essa atualização foi planejada para permitir que muito mais pessoas se conectem simultaneamente, trazendo maior estabilidade, menor latência e suporte a grandes comunidades.
                </p>
              </div>

              {/* Card 2: Possíveis Instabilidades */}
              <div className={styles.migrationWarningBox}>
                <i className={`fa-solid fa-triangle-exclamation ${styles.migrationWarningBoxIcon}`} />
                <div className={styles.migrationWarningBoxContent}>
                  <span className={styles.migrationWarningBoxTitle}>Possíveis Instabilidades Momentâneas</span>
                  <p className={styles.migrationWarningBoxText}>
                    Durante o processo de transição e sincronização de dados nos próximos dias, é possível que ocorram pequenas instabilidades temporárias ou breves oscilações de conexão na plataforma. Nossa equipe estará monitorando tudo de perto para minimizar qualquer impacto.
                  </p>
                </div>
              </div>

              {/* Card 3: Agradecimento */}
              <div className={styles.migrationThanksBox}>
                <i className="fa-solid fa-heart" />
                <span>
                  Agradecemos imensamente pela sua compreensão, paciência e apoio contínuo enquanto preparamos o Concord para uma nova fase ainda mais rápida e escalável!
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className={styles.migrationFooter}>
              <div className={styles.migrationStatusPill}>
                <span className={styles.migrationStatusDot} />
                <span>Status: Migração Programada</span>
              </div>
              <button
                type="button"
                className={styles.migrationConfirmBtn}
                onClick={() => setIsMigrationModalOpen(false)}
              >
                <i className="fa-solid fa-check" />
                <span>Entendido</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
