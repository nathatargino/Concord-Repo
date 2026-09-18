import { useAppStore } from '../stores/useAppStore';

/**
 * Envia uma notificação do sistema diretamente para o chat da sala/servidor ativo.
 * Substitui notificações flutuantes (toasts) no topo da tela.
 */
export function notifyInChat(message: string, channelId?: string) {
  useAppStore.getState().addSystemMessage(message, channelId);
}
