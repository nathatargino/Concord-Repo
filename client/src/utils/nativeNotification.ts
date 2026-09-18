interface NotificationPayload {
  userName: string;
  message: string;
  roomName?: string;
  avatarUrl?: string | null;
  sentAt?: number;
}

export const APP_START_TIME = Date.now();

/**
 * Exibe notificação nativa do Windows (via Electron) ou Web Notification API.
 */
export function showNativeChatNotification({ userName, message, roomName, avatarUrl, sentAt }: NotificationPayload) {
  // Ignorar notificações de mensagens enviadas antes de abrir o aplicativo
  if (typeof sentAt === 'number' && sentAt > 0 && sentAt < APP_START_TIME) {
    return;
  }

  if (typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) {
    return;
  }

  const electron = (window as any).electron;

  if (electron?.showNotification) {
    electron.showNotification({
      userName,
      message,
      roomName,
      avatarUrl: avatarUrl || null,
      sentAt,
    });
    return;
  }

  // Fallback para navegador web comum
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const title = roomName ? `${userName} (${roomName})` : userName;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: message,
          icon: avatarUrl || '/logo.png',
        });
      } catch (err) {
        console.warn('[Notification] Browser notification failed:', err);
      }
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          try {
            new Notification(title, {
              body: message,
              icon: avatarUrl || '/logo.png',
            });
          } catch (err) {
            console.warn('[Notification] Browser notification failed:', err);
          }
        }
      }).catch(() => {});
    }
  }
}
