import { supabase } from './supabase';
import { useAppStore } from '../stores/useAppStore';
import { toast } from 'react-hot-toast';
import { playChimeSound } from '../hooks/useAudio';
import { showNativeChatNotification, showNativeFriendRequestNotification } from '../utils/nativeNotification';
import type { Friend } from './supabase';

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

export function initSocialRealtime() {
  if (isInitialized && socialChannel) return;
  isInitialized = true;

  try {
    socialChannel = supabase.channel(SOCIAL_CHANNEL_NAME);

    // ── 1. RECEIVE FRIEND REQUEST ──
    socialChannel.on('broadcast', { event: 'friend_request' }, ({ payload }: { payload: any }) => {
      handleIncomingFriendRequest(payload);
    });

    // ── 2. RECEIVE FRIEND REQUEST RESPONSE (ACCEPT / DECLINE) ──
    socialChannel.on('broadcast', { event: 'friend_request_response' }, ({ payload }: { payload: any }) => {
      handleIncomingFriendResponse(payload);
    });

    // ── 3. RECEIVE FRIEND REQUEST CANCELLED ──
    socialChannel.on('broadcast', { event: 'friend_request_cancelled' }, ({ payload }: { payload: any }) => {
      handleIncomingFriendCancelled(payload);
    });

    // ── 4. RECEIVE DIRECT MESSAGE (DM) ──
    socialChannel.on('broadcast', { event: 'direct_message' }, ({ payload }: { payload: any }) => {
      handleIncomingDirectMessage(payload);
    });

    socialChannel.subscribe((status: string) => {
      console.log('[SocialRealtime] Subscribed to global channel status:', status);
    });
  } catch (err) {
    console.warn('[SocialRealtime] Erro ao conectar ao canal Supabase Realtime:', err);
  }

  // ── 5. SINCRONIZAÇÃO ENTRE JANELAS LOCAIS (CROSS-WINDOW STORAGE EVENT) ──
  if (typeof window !== 'undefined') {
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
    // Don't process requests sent from myself
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
  const matchIndex = currentFriends.findIndex(f =>
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
    let updated = currentFriends.map(f => {
      if (
        (data.responderId && (f.friendId === data.responderId || f.userId === data.responderId)) ||
        (data.responderName && cleanName(f.friendName) === cleanName(data.responderName))
      ) {
        return { ...f, status: 'accepted' as const, onlineStatus: 'online' as const };
      }
      return f;
    });

    const found = updated.some(f => cleanName(f.friendName) === cleanName(data.responderName));
    if (!found) {
      updated = [{
        id: `accepted-${Date.now()}`,
        userId: myId || 'me',
        friendId: data.responderId || `friend-${Date.now()}`,
        friendName: data.responderName,
        friendAvatarUrl: data.responderAvatarUrl || null,
        friendTag: data.responderTag || '0000',
        status: 'accepted',
        onlineStatus: 'online',
        isIncomingRequest: false,
      }, ...updated];
    }

    store.setFriends(updated);
    try {
      localStorage.setItem('concord_mock_friends', JSON.stringify(updated));
    } catch {}

    playChimeSound();
    toast.success(`${data.responderName} aceitou seu pedido de amizade! 🎉`, {
      duration: 6000,
    });

    showNativeFriendRequestNotification(data.responderName, data.responderAvatarUrl, `${data.responderName} aceitou sua solicitação de amizade!`);
    window.dispatchEvent(new CustomEvent('concord:friends-updated'));
  } else if (data.action === 'decline') {
    const updated = currentFriends.filter(f =>
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
  const updated = currentFriends.filter(f =>
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
export function handleIncomingDirectMessage(data: any) {
  if (!data) return;
  const store = useAppStore.getState();
  const myName = cleanName(store.myName || localStorage.getItem('concord_username'));
  const myId = store.myId || localStorage.getItem('concord_user_id');
  const myPersistentId = localStorage.getItem('concord_persistent_id');
  const sock = (window as any).__concord_socket;
  const socketId = sock?.id;

  const senderName = cleanName(data.senderName);
  const isFromMe = (data.senderId && data.senderId === myId) || (senderName && myName && senderName === myName);
  if (isFromMe) return;

  const targetName = cleanName(data.targetName);
  const targetId = (data.targetUserId || '').trim();

  const isForMe = Boolean(
    (targetName && myName && targetName === myName) ||
    (targetId && (targetId === myId || targetId === socketId || targetId === myPersistentId))
  );

  if (!isForMe) return;

  console.log('[SocialRealtime] Nova DM recebida de:', data.senderName, data.content);

  const senderLower = senderName;
  const pairKey = [myName, senderLower].sort().join('__');

  const storageKeys = [
    `concord_dm_${data.chatId}`,
    `concord_dm_user_${senderLower}`,
    `concord_dm_pair_${pairKey}`,
  ];

  for (const k of storageKeys) {
    try {
      const raw = localStorage.getItem(k);
      const list = raw ? JSON.parse(raw) : [];
      if (!list.some((m: any) => m.id === data.id || (m.content === data.content && m.senderName === data.senderName && Math.abs(new Date(m.createdAt).getTime() - new Date(data.createdAt).getTime()) < 2000))) {
        list.push(data);
        localStorage.setItem(k, JSON.stringify(list));
      }
    } catch {}
  }

  // Garantir que chat existe na lista de chats diretos
  try {
    const rawChats = localStorage.getItem('concord_direct_chats');
    const chatList = rawChats ? JSON.parse(rawChats) : [];
    const exists = chatList.some((c: any) =>
      c.id === data.chatId ||
      (c.partnerName && cleanName(c.partnerName) === senderLower) ||
      (c.partnerId && c.partnerId === data.senderId)
    );
    if (!exists) {
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

  window.dispatchEvent(new CustomEvent('concord:new-dm-message', { detail: data }));

  showNativeChatNotification({
    userName: data.senderName,
    message: data.content,
    roomName: 'Mensagem Direta',
    avatarUrl: data.senderAvatarUrl,
    sentAt: Date.now(),
  });
  playChimeSound();

  const activeDmChat = store.activeDmChat;
  const isAlreadyInThisDm = activeDmChat && (
    activeDmChat.id === data.chatId ||
    cleanName(activeDmChat.partnerName) === senderLower
  );

  if (!isAlreadyInThisDm) {
    toast(`Nova mensagem de ${data.senderName}: ${data.content.slice(0, 35)}${data.content.length > 35 ? '...' : ''}`, {
      icon: '💬',
      duration: 5000,
    });
  }
}

// ── BROADCAST DISPATCHERS ──
export function broadcastFriendRequest(payload: any) {
  // 1. Supabase Realtime broadcast
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

  // 2. Direct Socket Signaling (via send_offer)
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
  if (sock && payload.targetUserId) {
    try {
      sock.emit('send_offer', payload.targetUserId, {
        type: 'concord_system_event',
        event: 'receive_direct_message',
        payload,
      });
    } catch {}
  }
}
