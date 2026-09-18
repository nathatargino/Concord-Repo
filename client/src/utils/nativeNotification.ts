interface NotificationPayload {
  userName: string;
  message: string;
  roomName?: string;
  avatarUrl?: string | null;
}

/**
 * Exibe notificação nativa do Windows (via Electron) ou Web Notification API.
 */
export function showNativeChatNotification({ userName, message, roomName, avatarUrl }: NotificationPayload) {
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
