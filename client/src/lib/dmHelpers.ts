import { useAppStore } from '../stores/useAppStore';
import { cleanDisplayName, type DirectMessage } from './supabase';

const MUTED_DMS_STORAGE_KEY = 'concord_muted_dms';

export function getMutedDmTokens(): string[] {
  try {
    const raw = localStorage.getItem(MUTED_DMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isDmMuted(chatId?: string | null, partnerName?: string | null): boolean {
  if (!chatId && !partnerName) return false;
  const tokens = getMutedDmTokens();
  if (tokens.length === 0) return false;

  const normalizedChatId = (chatId || '').trim();
  const normalizedPartner = cleanDisplayName(partnerName || '').toLowerCase();

  return tokens.some((t) => {
    const norm = String(t).trim().toLowerCase();
    return (
      (normalizedChatId && (norm === normalizedChatId.toLowerCase() || normalizedChatId.toLowerCase().includes(norm))) ||
      (normalizedPartner && (norm === normalizedPartner || normalizedPartner.includes(norm)))
    );
  });
}

export function toggleMuteDm(chatId: string, partnerName?: string): boolean {
  const currentMuted = isDmMuted(chatId, partnerName);
  const tokens = getMutedDmTokens();
  const cleanPartner = partnerName ? cleanDisplayName(partnerName).toLowerCase() : '';

  let updated: string[];
  if (currentMuted) {
    // Desilenciar
    updated = tokens.filter((t) => {
      const norm = String(t).trim().toLowerCase();
      if (chatId && norm === chatId.toLowerCase()) return false;
      if (cleanPartner && norm === cleanPartner) return false;
      return true;
    });
  } else {
    // Silenciar
    updated = [...tokens];
    if (chatId && !updated.includes(chatId)) updated.push(chatId);
    if (cleanPartner && !updated.includes(cleanPartner)) updated.push(cleanPartner);
  }

  try {
    localStorage.setItem(MUTED_DMS_STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  window.dispatchEvent(
    new CustomEvent('concord:dm-mute-changed', {
      detail: { chatId, partnerName, isMuted: !currentMuted },
    })
  );

  return !currentMuted;
}

export function deleteDmConversation(chatId: string, partnerName?: string): void {
  const store = useAppStore.getState();
  const myName = cleanDisplayName(store.myName || localStorage.getItem('concord_username') || '').toLowerCase();
  const cleanPartner = partnerName ? cleanDisplayName(partnerName).toLowerCase() : '';
  const pairKey = [myName, cleanPartner].filter(Boolean).sort().join('__');

  // 1. Remover de concord_direct_chats
  try {
    const rawChats = localStorage.getItem('concord_direct_chats');
    if (rawChats) {
      const chatList = JSON.parse(rawChats);
      const filtered = chatList.filter((c: any) => {
        if (c.id === chatId) return false;
        if (cleanPartner && cleanDisplayName(c.partnerName || '').toLowerCase() === cleanPartner) return false;
        return true;
      });
      localStorage.setItem('concord_direct_chats', JSON.stringify(filtered));
      store.setDirectChats(filtered);
    }
  } catch {}

  // 2. Limpar mensagens locais
  const keysToRemove = [
    `concord_dm_${chatId}`,
    ...(pairKey ? [`concord_dm_pair_${pairKey}`] : []),
    ...(cleanPartner ? [`concord_dm_user_${cleanPartner}`] : []),
  ];

  for (const k of keysToRemove) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }

  // 3. Se esta DM estiver atualmente aberta, fechar e voltar para o Hub
  const activeChat = store.activeDmChat;
  if (
    activeChat &&
    (activeChat.id === chatId || (cleanPartner && cleanDisplayName(activeChat.partnerName || '').toLowerCase() === cleanPartner))
  ) {
    store.setActiveDmChat(null);
    store.setHomeTab('friends');
  }

  // 4. Notificar a aplicação
  window.dispatchEvent(new CustomEvent('concord:direct-chats-updated'));
  window.dispatchEvent(new CustomEvent('concord:dm-deleted', { detail: { chatId, partnerName } }));
}

export function deleteDmMessage(messageId: string, chatId?: string, partnerName?: string): void {
  const store = useAppStore.getState();
  const myName = cleanDisplayName(store.myName || localStorage.getItem('concord_username') || '').toLowerCase();
  const cleanPartner = partnerName ? cleanDisplayName(partnerName).toLowerCase() : '';
  const pairKey = [myName, cleanPartner].filter(Boolean).sort().join('__');

  const keysToCheck = [
    ...(chatId ? [`concord_dm_${chatId}`] : []),
    ...(pairKey ? [`concord_dm_pair_${pairKey}`] : []),
    ...(cleanPartner ? [`concord_dm_user_${cleanPartner}`] : []),
  ];

  for (const k of keysToCheck) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const list: DirectMessage[] = JSON.parse(raw);
        const filtered = list.filter((m) => m.id !== messageId);
        localStorage.setItem(k, JSON.stringify(filtered));
      }
    } catch {}
  }

  window.dispatchEvent(
    new CustomEvent('concord:dm-message-deleted', {
      detail: { messageId, chatId },
    })
  );
}
