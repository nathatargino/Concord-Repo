import { supabase, cleanDisplayName } from './supabase';
import { useAppStore } from '../stores/useAppStore';
import { toast } from 'react-hot-toast';
import { playChimeSound } from '../hooks/useAudio';
import { showNativeChatNotification, showNativeFriendRequestNotification } from '../utils/nativeNotification';
import type { Friend } from './supabase';
import { isDmMuted } from './dmHelpers';

const SOCIAL_CHANNEL_NAME = 'concord-global-social-v1';

export function cleanName(name?: string | null): string {
  if (!name) return '';
  let clean = String(name).trim();
  if (clean.startsWith('@')) clean = clean.substring(1).trim();
  if (clean.includes('#')) clean = clean.split('#')[0].trim();
  return clean.toLowerCase();
}

let socialChannel: any = null;
let isInitialized = false;
let isSubscribed = false;
let reconnectTimer: any = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
let globalListenersAttached = false;

/**
 * Obtém o payload atualizado de presença do usuário logado/local
 */
export function getCurrentUserPresencePayload() {
  const store = useAppStore.getState();
  const myId =
    store.myId ||
    localStorage.getItem('concord_user_id') ||
    localStorage.getItem('concord_pid') ||
    'anonymous';
  const myName = cleanDisplayName(
    store.myName || localStorage.getItem('concord_username') || 'Usuário'
  );
  const myAvatar =
    store.myAvatarUrl ||
    localStorage.getItem('concord_avatar_url') ||
    null;
  const myTag =
    store.myTag ||
    localStorage.getItem('concord_user_tag') ||
    '0000';

  return {
    userId: myId,
    userName: myName,
    avatarUrl: myAvatar,
    customTag: myTag,
    onlineAt: new Date().toISOString(),
  };
}

/**
 * Limpa o canal global e desfaz subscrições para evitar vazamento ou duplicação
 */
export async function cleanupSocialRealtime(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  isSubscribed = false;

  if (socialChannel) {
    try {
      await socialChannel.untrack();
    } catch {}
    try {
      await supabase.removeChannel(socialChannel);
    } catch {}
    socialChannel = null;
  }

  try {
    const existing = supabase
      .getChannels()
      .filter(
        (c: any) =>
          c.topic === SOCIAL_CHANNEL_NAME ||
          c.topic === `realtime:${SOCIAL_CHANNEL_NAME}`
      );
    for (const ch of existing) {
      try {
        await supabase.removeChannel(ch);
      } catch {}
    }
  } catch (err) {
    console.warn('[SocialRealtime] Erro ao remover canais residuais:', err);
  }

  isInitialized = false;
}

/**
 * Agenda reconexão resiliente com backoff exponencial
 */
function scheduleResilientReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  console.log(
    `[SocialRealtime] Agendando reconexão resiliente em ${delay}ms (tentativa ${reconnectAttempts})...`
  );

  reconnectTimer = setTimeout(() => {
    initSocialRealtime(true);
  }, delay);
}

/**
 * Inicializa o canal do Supabase Realtime com presença, broadcast de eventos sociais e reconexão resiliente
 */
export function initSocialRealtime(force = false) {
  if (isInitialized && socialChannel && !force) return;

  // Limpeza preventiva de canais duplicados antes de conectar
  if (socialChannel || force) {
    try {
      if (socialChannel) {
        supabase.removeChannel(socialChannel);
        socialChannel = null;
      }
      const existing = supabase
        .getChannels()
        .filter(
          (c: any) =>
            c.topic === SOCIAL_CHANNEL_NAME ||
            c.topic === `realtime:${SOCIAL_CHANNEL_NAME}`
        );
      for (const ch of existing) {
        try {
          supabase.removeChannel(ch);
        } catch {}
      }
    } catch (cleanupErr) {
      console.warn('[SocialRealtime] Limpeza preventiva de canal:', cleanupErr);
    }
  }

  isInitialized = true;

  try {
    const presenceKey =
      useAppStore.getState().myId ||
      localStorage.getItem('concord_user_id') ||
      localStorage.getItem('concord_pid') ||
      `user-${Date.now()}`;

    socialChannel = supabase.channel(SOCIAL_CHANNEL_NAME, {
      config: {
        presence: {
          key: presenceKey,
        },
      },
    });

    // ── 1. RECEIVE FRIEND REQUEST ──
    socialChannel.on(
      'broadcast',
      { event: 'friend_request' },
      ({ payload }: { payload: any }) => {
        handleIncomingFriendRequest(payload);
      }
    );

    // ── 2. RECEIVE FRIEND REQUEST RESPONSE (ACCEPT / DECLINE) ──
    socialChannel.on(
      'broadcast',
      { event: 'friend_request_response' },
      ({ payload }: { payload: any }) => {
        handleIncomingFriendResponse(payload);
      }
    );

    // ── 3. RECEIVE FRIEND REQUEST CANCELLED ──
    socialChannel.on(
      'broadcast',
      { event: 'friend_request_cancelled' },
      ({ payload }: { payload: any }) => {
        handleIncomingFriendCancelled(payload);
      }
    );

    // ── 4. RECEIVE DIRECT MESSAGE (DM) ──
    socialChannel.on(
      'broadcast',
      { event: 'direct_message' },
      ({ payload }: { payload: any }) => {
        handleIncomingDirectMessage(payload);
      }
    );

    // ── 5. RECEIVE PROFILE & AVATAR UPDATES ──
    socialChannel.on(
      'broadcast',
      { event: 'profile_updated' },
      ({ payload }: { payload: any }) => {
        handleIncomingProfileUpdate(payload);
      }
    );

    // ── 6. PRESENCE TRACKING & REALTIME SYNC ──
    socialChannel.on('presence', { event: 'sync' }, () => {
      handlePresenceSync();
    });

    socialChannel.on(
      'presence',
      { event: 'join' },
      ({ key, newPresences }: { key: string; newPresences: any[] }) => {
        handlePresenceJoin(key, newPresences);
      }
    );

    socialChannel.on(
      'presence',
      { event: 'leave' },
      ({ key, leftPresences }: { key: string; leftPresences: any[] }) => {
        handlePresenceLeave(key, leftPresences);
      }
    );

    socialChannel.subscribe(async (status: string) => {
      console.log('[SocialRealtime] Subscribed to global channel status:', status);
      if (status === 'SUBSCRIBED') {
        isSubscribed = true;
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        try {
          await socialChannel.track(getCurrentUserPresencePayload());
        } catch (trackErr) {
          console.warn('[SocialRealtime] Erro ao registrar presença no track:', trackErr);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        isSubscribed = false;
        scheduleResilientReconnect();
      }
    });
  } catch (err) {
    console.warn('[SocialRealtime] Erro ao conectar ao canal Supabase Realtime:', err);
    scheduleResilientReconnect();
  }

  // ── 7. ATTACH GLOBAL LISTENERS (Attached Once) ──
  if (!globalListenersAttached && typeof window !== 'undefined') {
    globalListenersAttached = true;

    // Cross-Window Storage Event
    window.addEventListener('storage', (e) => {
      if (e.key === 'concord_mock_friends' && e.newValue) {
        try {
          const list: Friend[] = JSON.parse(e.newValue);
          useAppStore.getState().setFriends(list);
          window.dispatchEvent(new CustomEvent('concord:friends-updated'));
        } catch {}
      } else if (e.key === 'concord_direct_chats' && e.newValue) {
        try {
          const chats = JSON.parse(e.newValue);
          useAppStore.getState().setDirectChats(chats);
          window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
        } catch {}
      } else if (e.key && e.key.startsWith('concord_dm_') && e.newValue) {
        try {
          const messages = JSON.parse(e.newValue);
          const lastMsg = messages[messages.length - 1];
          if (lastMsg) {
            window.dispatchEvent(new CustomEvent('concord:new-dm-message', { detail: lastMsg }));
          }
        } catch {}
      }
    });

    // Network Online Reconnect
    window.addEventListener('online', () => {
      console.log('[SocialRealtime] Rede restaurada (online). Reinicializando presença social...');
      initSocialRealtime(true);
    });

    // Tab/Window Visibility Change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!socialChannel || !isSubscribed) {
          initSocialRealtime(true);
        } else {
          updateMyPresence();
        }
      }
    });

    // Local Profile Updated Event
    window.addEventListener('concord:profile-updated', () => {
      updateMyPresence();
    });
  }
}

/**
 * Atualiza a presença do usuário conectado no canal do Supabase Realtime
 */
export async function updateMyPresence(
  presenceOverride?: Partial<{
    avatarUrl: string | null;
    customTag: string;
    userName: string;
  }>
): Promise<void> {
  if (!socialChannel || !isSubscribed) return;

  const current = getCurrentUserPresencePayload();
  const merged = {
    ...current,
    ...presenceOverride,
    onlineAt: new Date().toISOString(),
  };

  try {
    await socialChannel.track(merged);
  } catch (err) {
    console.warn('[SocialRealtime] Falha ao atualizar presença:', err);
  }
}

/**
 * Retorna lista consolidada de presenças ativas no canal
 */
export function getActiveSocialPresences(): any[] {
  if (!socialChannel) return [];
  try {
    const presenceState = socialChannel.presenceState();
    const list: any[] = [];
    Object.values(presenceState).forEach((presences: any) => {
      if (Array.isArray(presences)) {
        list.push(...presences);
      }
    });
    return list;
  } catch {
    return [];
  }
}

/**
 * Processa a sincronização de presença e reflete no estado de amigos e chats diretos
 */
function handlePresenceSync() {
  if (!socialChannel) return;
  try {
    const presenceState = socialChannel.presenceState();
    const activePresences: any[] = [];
    Object.values(presenceState).forEach((presences: any) => {
      if (Array.isArray(presences)) {
        activePresences.push(...presences);
      }
    });

    const activeUserIds = new Set<string>();
    const activeUsernames = new Map<string, any>();

    for (const p of activePresences) {
      if (p.userId) activeUserIds.add(String(p.userId).trim());
      if (p.userName) {
        const cName = cleanName(p.userName);
        if (cName) activeUsernames.set(cName, p);
      }
    }

    const store = useAppStore.getState();
    const currentFriends = store.friends || [];
    let friendsChanged = false;

    const updatedFriends = currentFriends.map((friend) => {
      const fId = friend.friendId ? String(friend.friendId).trim() : '';
      const fName = cleanName(friend.friendName);

      const matchedPresence =
        (fId && activeUserIds.has(fId))
          ? activePresences.find((p) => String(p.userId).trim() === fId)
          : (fName ? activeUsernames.get(fName) : undefined);

      const isOnline = Boolean(matchedPresence);
      const targetStatus: 'online' | 'offline' = isOnline ? 'online' : 'offline';

      let newAvatar = friend.friendAvatarUrl;
      let newTag = friend.friendTag;

      if (matchedPresence) {
        if (matchedPresence.avatarUrl && matchedPresence.avatarUrl !== friend.friendAvatarUrl) {
          newAvatar = matchedPresence.avatarUrl;
        }
        if (matchedPresence.customTag && matchedPresence.customTag !== friend.friendTag) {
          newTag = matchedPresence.customTag;
        }
      }

      if (
        friend.onlineStatus !== targetStatus ||
        newAvatar !== friend.friendAvatarUrl ||
        newTag !== friend.friendTag
      ) {
        friendsChanged = true;
        return {
          ...friend,
          onlineStatus: targetStatus,
          friendAvatarUrl: newAvatar,
          friendTag: newTag,
        };
      }
      return friend;
    });

    if (friendsChanged) {
      store.setFriends(updatedFriends);
      try {
        localStorage.setItem('concord_mock_friends', JSON.stringify(updatedFriends));
      } catch {}
      window.dispatchEvent(new CustomEvent('concord:friends-updated'));
      window.dispatchEvent(
        new CustomEvent('concord:presence-updated', {
          detail: { activeCount: activePresences.length, presences: activePresences },
        })
      );
    }

    // Atualiza metadados e avatares nos chats diretos se houver parceiro presente
    const currentChats = store.directChats || [];
    let chatsChanged = false;
    const updatedChats = currentChats.map((chat) => {
      const pId = chat.partnerId ? String(chat.partnerId).trim() : '';
      const pName = cleanName(chat.partnerName);

      const matched =
        (pId && activeUserIds.has(pId))
          ? activePresences.find((p) => String(p.userId).trim() === pId)
          : (pName ? activeUsernames.get(pName) : undefined);

      if (matched && matched.avatarUrl && matched.avatarUrl !== chat.partnerAvatarUrl) {
        chatsChanged = true;
        return {
          ...chat,
          partnerAvatarUrl: matched.avatarUrl,
          partnerTag: matched.customTag || chat.partnerTag,
        };
      }
      return chat;
    });

    if (chatsChanged) {
      store.setDirectChats(updatedChats);
      try {
        localStorage.setItem('concord_direct_chats', JSON.stringify(updatedChats));
      } catch {}
      window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
    }
  } catch (err) {
    console.warn('[SocialRealtime] Erro ao sincronizar estado de presença:', err);
  }
}

function handlePresenceJoin(_key: string, _newPresences: any[]) {
  handlePresenceSync();
}

function handlePresenceLeave(_key: string, _leftPresences: any[]) {
  handlePresenceSync();
}

// ── PROCESS INCOMING PROFILE UPDATE ──
export function handleIncomingProfileUpdate(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId =
    store.myId ||
    localStorage.getItem('concord_user_id') ||
    localStorage.getItem('concord_pid');

  const senderName = cleanName(data.username);
  const senderId = data.userId ? String(data.userId).trim() : '';

  // Ignora se for o próprio usuário
  if ((senderId && senderId === myId) || (senderName && myName && senderName === myName)) {
    return;
  }

  console.log('[SocialRealtime] Atualização de perfil recebida de:', data.username, data.avatarUrl);

  // 1. Atualizar lista de amigos
  const currentFriends = store.friends || [];
  let friendsChanged = false;
  const updatedFriends = currentFriends.map((f) => {
    const matchesId = senderId && (f.friendId === senderId || f.userId === senderId);
    const matchesName = senderName && cleanName(f.friendName) === senderName;
    if (matchesId || matchesName) {
      friendsChanged = true;
      return {
        ...f,
        friendName: data.username || f.friendName,
        friendAvatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : f.friendAvatarUrl,
        friendTag: data.customTag || f.friendTag,
      };
    }
    return f;
  });

  if (friendsChanged) {
    store.setFriends(updatedFriends);
    try {
      localStorage.setItem('concord_mock_friends', JSON.stringify(updatedFriends));
    } catch {}
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));
  }

  // 2. Atualizar chats diretos
  const currentChats = store.directChats || [];
  let chatsChanged = false;
  const updatedChats = currentChats.map((c) => {
    const matchesId = senderId && c.partnerId === senderId;
    const matchesName = senderName && cleanName(c.partnerName) === senderName;
    if (matchesId || matchesName) {
      chatsChanged = true;
      return {
        ...c,
        partnerName: data.username || c.partnerName,
        partnerAvatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : c.partnerAvatarUrl,
        partnerTag: data.customTag || c.partnerTag,
      };
    }
    return c;
  });

  if (chatsChanged) {
    store.setDirectChats(updatedChats);
    try {
      localStorage.setItem('concord_direct_chats', JSON.stringify(updatedChats));
    } catch {}
    window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
  }

  window.dispatchEvent(new CustomEvent('concord:peer-profile-updated', { detail: data }));
}

// ── BROADCAST PROFILE UPDATE ──
export function broadcastProfileUpdate(payload: {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  customTag?: string;
  updatedAt?: string;
}) {
  const fullPayload = {
    ...payload,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };

  if (socialChannel) {
    try {
      socialChannel.send({
        type: 'broadcast',
        event: 'profile_updated',
        payload: fullPayload,
      });
    } catch (err) {
      console.warn('[SocialRealtime] Erro ao enviar broadcast de profile_updated:', err);
    }
  }

  const sock = (window as any).__concord_socket;
  if (sock) {
    try {
      sock.emit('send_offer', 'broadcast', {
        type: 'concord_system_event',
        event: 'profile_updated',
        payload: fullPayload,
      });
    } catch {}
  }
}

// ── PROCESS INCOMING FRIEND REQUEST ──
export function handleIncomingFriendRequest(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId = store.myId || localStorage.getItem('concord_user_id');
  const myPersistentId = localStorage.getItem('concord_persistent_id');
  const sock = (window as any).__concord_socket;
  const socketId = sock?.id;

  const senderName = cleanName(data.senderName);
  if (senderName && myName && senderName === myName) {
    return;
  }

  const targetName = cleanName(data.targetName);
  const targetId = (data.targetUserId || '').trim();

  const isForMe = Boolean(
    (targetName && myName && targetName === myName) ||
    (targetId && (targetId === myId || targetId === socketId || targetId === myPersistentId))
  );

  if (!isForMe) return;

  console.log('[SocialRealtime] Pedido de amizade recebido para mim de:', data.senderName);

  const newFriend: Friend = {
    id: data.id || `fr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: myId || 'me',
    friendId: data.senderId || `user-${Date.now()}`,
    friendName: data.senderName || 'Usuário',
    friendAvatarUrl: data.senderAvatarUrl || null,
    friendTag: data.senderTag || '0000',
    status: 'pending',
    isIncomingRequest: true,
    onlineStatus: 'online',
  };

  const currentFriends = store.friends || [];
  const matchIndex = currentFriends.findIndex(
    (f) =>
      f.id === newFriend.id ||
      (f.friendId && f.friendId === newFriend.friendId) ||
      (f.friendName && cleanName(f.friendName) === cleanName(newFriend.friendName))
  );

  let updated: Friend[];
  if (matchIndex >= 0) {
    updated = [...currentFriends];
    updated[matchIndex] = {
      ...updated[matchIndex],
      ...newFriend,
      status: 'pending',
      isIncomingRequest: true,
      onlineStatus: 'online',
    };
  } else {
    updated = [newFriend, ...currentFriends];
  }

  store.setFriends(updated);
  try {
    localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
  } catch {}

  playChimeSound();
  toast(`Nova solicitação de amizade de ${data.senderName}!`, {
    icon: '👋',
    duration: 6000,
  });

  showNativeFriendRequestNotification(data.senderName, data.senderAvatarUrl);
  window.dispatchEvent(new CustomEvent('concord:friends-updated'));
}

// ── PROCESS FRIEND REQUEST RESPONSE (ACCEPT / DECLINE) ──
export function handleIncomingFriendResponse(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId = store.myId || localStorage.getItem('concord_user_id');
  const myPersistentId = localStorage.getItem('concord_persistent_id');
  const sock = (window as any).__concord_socket;
  const socketId = sock?.id;

  const targetName = cleanName(data.targetName);
  const targetId = (data.targetUserId || '').trim();

  const isForMe = Boolean(
    (targetName && myName && targetName === myName) ||
    (targetId && (targetId === myId || targetId === socketId || targetId === myPersistentId))
  );

  if (!isForMe) return;

  console.log('[SocialRealtime] Resposta de pedido de amizade recebida:', data);
  const currentFriends = store.friends || [];

  if (data.action === 'accept') {
    let updated = currentFriends.map((f) => {
      if (
        (data.responderId && (f.friendId === data.responderId || f.userId === data.responderId)) ||
        (data.responderName && cleanName(f.friendName) === cleanName(data.responderName))
      ) {
        return {
          ...f,
          status: 'accepted' as const,
          onlineStatus: 'online' as const,
          friendAvatarUrl: data.responderAvatarUrl || f.friendAvatarUrl,
          friendTag: data.responderTag || f.friendTag,
        };
      }
      return f;
    });

    const found = updated.some(
      (f) => cleanName(f.friendName) === cleanName(data.responderName)
    );
    if (!found) {
      updated = [
        {
          id: `accepted-${Date.now()}`,
          userId: myId || 'me',
          friendId: data.responderId || `friend-${Date.now()}`,
          friendName: data.responderName,
          friendAvatarUrl: data.responderAvatarUrl || null,
          friendTag: data.responderTag || '0000',
          status: 'accepted',
          onlineStatus: 'online',
          isIncomingRequest: false,
        },
        ...updated,
      ];
    }

    store.setFriends(updated);
    try {
      localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
    } catch {}

    playChimeSound();
    toast.success(`${data.responderName} aceitou seu pedido de amizade! 🎉`, {
      duration: 6000,
    });

    showNativeFriendRequestNotification(
      data.responderName,
      data.responderAvatarUrl,
      `${data.responderName} aceitou sua solicitação de amizade!`
    );
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));
  } else if (data.action === 'decline') {
    const updated = currentFriends.filter(
      (f) =>
        !(
          (data.responderId && (f.friendId === data.responderId || f.userId === data.responderId)) ||
          (data.responderName && cleanName(f.friendName) === cleanName(data.responderName))
        )
    );
    store.setFriends(updated);
    try {
      localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
    } catch {}
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));
  }
}

// ── PROCESS FRIEND REQUEST CANCELLED ──
export function handleIncomingFriendCancelled(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId = store.myId || localStorage.getItem('concord_user_id');
  const myPersistentId = localStorage.getItem('concord_persistent_id');
  const sock = (window as any).__concord_socket;
  const socketId = sock?.id;

  const targetName = cleanName(data.targetName);
  const targetId = (data.targetUserId || '').trim();

  const isForMe = Boolean(
    (targetName && myName && targetName === myName) ||
    (targetId && (targetId === myId || targetId === socketId || targetId === myPersistentId))
  );

  if (!isForMe) return;

  console.log('[SocialRealtime] Pedido de amizade cancelado pelo remetente:', data.senderName);
  const currentFriends = store.friends || [];
  const updated = currentFriends.filter(
    (f) =>
      !(
        (data.senderId && (f.friendId === data.senderId || f.userId === data.senderId)) ||
        (data.senderName && cleanName(f.friendName) === cleanName(data.senderName))
      )
  );

  store.setFriends(updated);
  try {
    localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
  } catch {}
  window.dispatchEvent(new CustomEvent('concord:friends-updated'));
}

// ── PROCESS INCOMING DIRECT MESSAGE ──
const processedDmIds = new Set<string>();

export function handleIncomingDirectMessage(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId = store.myId || localStorage.getItem('concord_user_id');
  const myPersistentId = localStorage.getItem('concord_persistent_id');
  const sock = (window as any).__concord_socket;
  const socketId = sock?.id;

  const senderName = cleanName(data.senderName);
  const isFromMe =
    (data.senderId && data.senderId === myId) ||
    (senderName && myName && senderName === myName);
  if (isFromMe) return;

  const targetName = cleanName(data.targetName);
  const targetId = (data.targetUserId || '').trim();
  const isDirectDelivery = Boolean(data.__directSocketDelivery);

  const isForMe = Boolean(
    isDirectDelivery ||
    (targetName && myName && (targetName === myName || targetName.includes(myName) || myName.includes(targetName))) ||
    (targetId && (targetId === myId || targetId === socketId || targetId === myPersistentId))
  );

  if (!isForMe) return;

  if (!data.id) {
    data.id = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // Deduplicação em memória para evitar processamento quadruplicado do mesmo pacote multi-transporte
  if (processedDmIds.has(data.id)) {
    return;
  }
  processedDmIds.add(data.id);
  if (processedDmIds.size > 500) {
    const first = processedDmIds.values().next().value;
    if (first) processedDmIds.delete(first);
  }

  console.log('[SocialRealtime] Nova DM recebida de:', data.senderName, data.content);

  const senderLower = senderName;
  const pairKey = [myName, senderLower].filter(Boolean).sort().join('__');

  const activeDm = store.activeDmChat;
  const isMatchingActiveDm = Boolean(
    activeDm &&
    (activeDm.id === data.chatId ||
      (activeDm.partnerName && cleanName(activeDm.partnerName) === senderLower) ||
      (activeDm.partnerId && data.senderId && activeDm.partnerId === data.senderId))
  );

  const storageKeys = Array.from(new Set([
    ...(data.chatId ? [`concord_dm_${data.chatId}`] : []),
    ...(isMatchingActiveDm && activeDm?.id ? [`concord_dm_${activeDm.id}`] : []),
    ...(senderLower ? [`concord_dm_user_${senderLower}`] : []),
    ...(pairKey ? [`concord_dm_pair_${pairKey}`, `concord_dm_dm-pair-${pairKey}`] : []),
  ]));

  for (const k of storageKeys) {
    try {
      const raw = localStorage.getItem(k);
      const list = raw ? JSON.parse(raw) : [];
      // Sanitiza mensagens antigas sem id e verifica apenas colisão exata de ID válido
      let listModified = false;
      for (let i = 0; i < list.length; i++) {
        if (list[i] && !list[i].id) {
          list[i].id = `dm-legacy-${i}-${Date.now()}`;
          listModified = true;
        }
      }
      const isDuplicate = list.some(
        (m: any) => Boolean(m && m.id && data.id && m.id === data.id)
      );
      if (!isDuplicate) {
        list.push(data);
        localStorage.setItem(k, JSON.stringify(list));
      } else if (listModified) {
        localStorage.setItem(k, JSON.stringify(list));
      }
    } catch {}
  }

  // Garantir que chat existe na lista de chats diretos e atualizar timestamp/avatar
  try {
    const rawChats = localStorage.getItem('concord_direct_chats');
    const chatList = rawChats ? JSON.parse(rawChats) : [];
    const existingIndex = chatList.findIndex(
      (c: any) =>
        c.id === data.chatId ||
        (c.partnerName && cleanName(c.partnerName) === senderLower) ||
        (c.partnerId && c.partnerId === data.senderId)
    );

    if (existingIndex >= 0) {
      const existingChat = chatList[existingIndex];
      existingChat.updatedAt = data.createdAt || new Date().toISOString();
      if (data.senderAvatarUrl) {
        existingChat.partnerAvatarUrl = data.senderAvatarUrl;
      }
      if (data.senderName && (!existingChat.partnerName || existingChat.partnerName === 'Usuário')) {
        existingChat.partnerName = data.senderName;
      }
      if (data.senderId && (!existingChat.partnerId || existingChat.partnerId.startsWith('friend-'))) {
        existingChat.partnerId = data.senderId;
      }
      if (data.chatId && !existingChat.id) {
        existingChat.id = data.chatId;
      }
      // Salva também sob o ID do existingChat caso seja diferente de data.chatId
      if (existingChat.id && existingChat.id !== data.chatId) {
        try {
          const kChat = `concord_dm_${existingChat.id}`;
          const rChat = localStorage.getItem(kChat);
          const lChat = rChat ? JSON.parse(rChat) : [];
          if (!lChat.some((m: any) => m && m.id && m.id === data.id)) {
            lChat.push(data);
            localStorage.setItem(kChat, JSON.stringify(lChat));
          }
        } catch {}
      }
      // Reordena para o topo dos chats ativos
      chatList.splice(existingIndex, 1);
      chatList.unshift(existingChat);
      localStorage.setItem('concord_direct_chats', JSON.stringify(chatList));
      store.setDirectChats(chatList);
      window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
    } else {
      const newChat = {
        id: data.chatId || `dm-pair-${pairKey}`,
        partnerId: data.senderId,
        partnerName: data.senderName,
        partnerAvatarUrl: data.senderAvatarUrl || null,
        partnerTag: data.senderTag || '0000',
        updatedAt: data.createdAt || new Date().toISOString(),
      };
      chatList.unshift(newChat);
      localStorage.setItem('concord_direct_chats', JSON.stringify(chatList));
      store.setDirectChats(chatList);
      window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
    }
  } catch {}

  // Sincronizar avatar do remetente na lista de amigos se aplicável
  if (data.senderAvatarUrl) {
    const currentFriends = store.friends || [];
    const friendIdx = currentFriends.findIndex(
      (f) =>
        (data.senderId && (f.friendId === data.senderId || f.userId === data.senderId)) ||
        (data.senderName && cleanName(f.friendName) === senderLower)
    );
    if (friendIdx >= 0 && currentFriends[friendIdx].friendAvatarUrl !== data.senderAvatarUrl) {
      const updatedF = [...currentFriends];
      updatedF[friendIdx] = { ...updatedF[friendIdx], friendAvatarUrl: data.senderAvatarUrl };
      store.setFriends(updatedF);
      try {
        localStorage.setItem('concord_mock_friends', JSON.stringify(updatedF));
      } catch {}
      window.dispatchEvent(new CustomEvent('concord:friends-updated'));
    }
  }

  window.dispatchEvent(new CustomEvent('concord:new-dm-message', { detail: data }));

  // Se a conversa estiver silenciada, não emitir som, notificação nativa nem toast
  const isMuted = isDmMuted(data.chatId, data.senderName);
  if (!isMuted) {
    showNativeChatNotification({
      userName: data.senderName,
      message: data.content,
      roomName: 'Mensagem Direta',
      avatarUrl: data.senderAvatarUrl,
      sentAt: Date.now(),
    });
    playChimeSound();

    const activeDmChat = store.activeDmChat;
    const isAlreadyInThisDm =
      activeDmChat &&
      (activeDmChat.id === data.chatId ||
        cleanName(activeDmChat.partnerName) === senderLower);

    if (!isAlreadyInThisDm) {
      toast(
        `Nova mensagem de ${data.senderName}: ${data.content.slice(0, 35)}${
          data.content.length > 35 ? '...' : ''
        }`,
        {
          icon: '💬',
          duration: 5000,
        }
      );
    }
  }
}

// ── BROADCAST DISPATCHERS ──
export function broadcastFriendRequest(payload: any) {
  if (socialChannel) {
    try {
      socialChannel.send({
        type: 'broadcast',
        event: 'friend_request',
        payload,
      });
    } catch (err) {
      console.warn('[SocialRealtime] Erro ao enviar broadcast de friend_request:', err);
    }
  }

  const sock = (window as any).__concord_socket;
  if (sock && payload.targetUserId) {
    try {
      sock.emit('send_offer', payload.targetUserId, {
        type: 'concord_system_event',
        event: 'receive_friend_request',
        payload,
      });
    } catch {}
  }
}

export function broadcastFriendRequestResponse(payload: any) {
  if (socialChannel) {
    try {
      socialChannel.send({
        type: 'broadcast',
        event: 'friend_request_response',
        payload,
      });
    } catch (err) {
      console.warn('[SocialRealtime] Erro ao enviar broadcast de friend_request_response:', err);
    }
  }

  const sock = (window as any).__concord_socket;
  if (sock && payload.targetUserId) {
    try {
      sock.emit('send_offer', payload.targetUserId, {
        type: 'concord_system_event',
        event: 'friend_request_response',
        payload,
      });
    } catch {}
  }
}

export function broadcastFriendRequestCancelled(payload: any) {
  if (socialChannel) {
    try {
      socialChannel.send({
        type: 'broadcast',
        event: 'friend_request_cancelled',
        payload,
      });
    } catch (err) {
      console.warn('[SocialRealtime] Erro ao enviar broadcast de friend_request_cancelled:', err);
    }
  }

  const sock = (window as any).__concord_socket;
  if (sock && payload.targetUserId) {
    try {
      sock.emit('send_offer', payload.targetUserId, {
        type: 'concord_system_event',
        event: 'friend_request_cancelled',
        payload,
      });
    } catch {}
  }
}

export function broadcastDirectMessage(payload: any) {
  if (!payload.id) {
    payload.id = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  if (socialChannel) {
    try {
      socialChannel.send({
        type: 'broadcast',
        event: 'direct_message',
        payload,
      });
    } catch (err) {
      console.warn('[SocialRealtime] Erro ao enviar broadcast de direct_message:', err);
    }
  }

  const sock = (window as any).__concord_socket;
  if (sock) {
    try {
      sock.emit('send_direct_message', payload);
    } catch {}
    if (payload.targetUserId) {
      try {
        sock.emit('send_offer', payload.targetUserId, {
          type: 'concord_system_event',
          event: 'receive_direct_message',
          payload,
        });
      } catch {}
    }
    if (payload.targetName) {
      try {
        sock.emit('send_offer', payload.targetName, {
          type: 'concord_system_event',
          event: 'receive_direct_message',
          payload,
        });
      } catch {}
    }
  }
}
