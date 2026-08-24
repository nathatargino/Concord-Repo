import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudio, monitorSpeaking, stopSpeaking } from './hooks/useAudio';
import { useYouTube } from './hooks/useYouTube';
import { useScreenShare } from './hooks/useScreenShare';
import { useAppStore } from './stores/useAppStore';
import { useAudioStore } from './stores/useAudioStore';

import { LoginModal } from './components/LoginModal';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';

import { MusicPanel } from './components/MusicPanel';
import { AudioControls } from './components/AudioControls';
import { ScreenSharePanel } from './components/ScreenSharePanel';
import { StatusBar } from './components/StatusBar';

import styles from './App.module.css';

export default function App() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const store = useAppStore();
  const [showLogin, setShowLogin] = useState(true);

  // ─── AUDIO SYSTEM ────────────────────────────────────────────────
  const audio = useAudio();

  // ─── YOUTUBE SYSTEM ──────────────────────────────────────────────
  const yt = useYouTube(
    useCallback((token) => {
      socket.emit('music_ended', token);
    }, [])
  );

  // Sync audio volumes when store changes
  useEffect(() => {
    const unsub = useAudioStore.subscribe(() => {
      audio.applyMicSettings();
      audio.applyRemoteSettings();
      yt.applyYTVolume();
    });
    return unsub;
  }, [audio, yt]);

  // ─── WEBRTC SYSTEM ───────────────────────────────────────────────
  const rtc = useWebRTC(
    (event, ...args) => socket.emit(event as any, ...args),
    audio.attachRemoteStream
  );

  let handleLeaveVoice = () => {};

  // ─── SOCKET CONNECTION ───────────────────────────────────────────
  const socket = useSocket({
    onExistingVoiceUsers: rtc.onExistingVoiceUsers,
    onUserJoinedVoice: rtc.onUserJoinedVoice,
    onUserLeftVoice: (userId) => {
      rtc.onUserLeftVoice(userId);
      audio.removeRemoteGain(userId);
    },
    onReceiveOffer: rtc.onReceiveOffer,
    onReceiveAnswer: rtc.onReceiveAnswer,
    onReceiveIce: rtc.onReceiveIce,
    onPlayYouTube: (videoId, startSeconds, token) => {
      if (useAppStore.getState().inVoice) {
        yt.playYouTube(videoId, startSeconds, token);
      }
    },
    onStopYouTube: yt.stopYouTube,
    onPauseYouTube: () => {
      if (useAppStore.getState().inVoice) yt.pauseYouTube();
    },
    onResumeYouTube: () => {
      if (useAppStore.getState().inVoice) yt.resumeYouTube();
    },
    onRoomError: (msg) => {
      // Room not found or expired → back to lobby
      console.warn('[Room] Error:', msg);
      store.setRoom(null);
      navigate('/');
    },
    onKickedFromVoice: () => handleLeaveVoice(),
    onKickedFromRoom: () => {
      store.setRoom(null);
      navigate('/');
    }
  });

  // ─── SCREEN SHARE SYSTEM ─────────────────────────────────────────
  const screenShare = useScreenShare(
    (event, ...args) => socket.emit(event as any, ...args),
    rtc.addScreenShareTrack,
    rtc.removeScreenShareTrack
  );

  // ─── JOIN ROOM on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!roomId) {
      navigate('/');
      return;
    }

    // If socket is connected, join the room immediately
    // useSocket also auto-rejoins on reconnect
    const tryJoin = () => {
      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }
      socket.emit('join_room', roomId, persistentId);
    };

    // Give socket a tick to connect
    const timer = setTimeout(tryJoin, 100);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ─── LOGIN ───────────────────────────────────────────────────────
  useEffect(() => {
    if (store.myName) {
      setShowLogin(false);
    }
  }, [store.myName]);

  const handleLogin = (name: string) => {
    store.setMyName(name);
    localStorage.setItem('concord_username_v1', name);
    socket.emit('set_username', name);
    setShowLogin(false);
  };

  // ─── ACTIONS ─────────────────────────────────────────────────────
  const handleJoinVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // @ts-ignore
          googNoiseSuppression: true,
          googHighpassFilter: true,
        },
      });
      const processedStream = audio.processMicStream(stream);
      await rtc.joinVoice(store.myId, processedStream);
      store.setInVoice(true);
      monitorSpeaking(processedStream, store.myId);
    } catch (err) {
      console.error('Mic error', err);
      alert('Erro ao acessar o microfone. Verifique as permissões.');
    }
  };

  handleLeaveVoice = () => {
    rtc.leaveVoice();
    store.setInVoice(false);
    if (store.amSharing) {
      screenShare.stopScreenShare();
    }
    yt.stopYouTube();
    stopSpeaking(store.myId);
  };


  return (
    <div className={styles.appContainer}>
      <Toaster position="top-right" toastOptions={{ style: { background: '#1A1A28', color: '#fff', border: '1px solid #7C3AED' } }} />

      {showLogin && <LoginModal onLogin={handleLogin} />}

      <Sidebar 
        onScreenShareClick={(id) => {
          const u = store.users.find(x => x.id === id);
          store.setScreenShare(id, u?.name);
        }}
        onJoinVoice={handleJoinVoice}
        onLeaveVoice={handleLeaveVoice}
        onStartScreenShare={screenShare.startScreenShare}
        onStopScreenShare={screenShare.stopScreenShare}
        onAdminAction={(action, targetId) => {
          if (action === 'mute') socket.emit('admin_mute_user', targetId);
          else if (action === 'unmute') socket.emit('admin_unmute_user', targetId);
          else if (action === 'kick_voice') socket.emit('admin_kick_voice', targetId);
          else if (action === 'kick_room') socket.emit('admin_kick_room', targetId);
          else if (action === 'give_admin') socket.emit('admin_transfer_role', targetId);
          else if (action === 'local_mute') useAudioStore.getState().toggleLocalMuteUser(targetId);
        }}
      />

      <main className={styles.mainContent}>
        <div className={styles.chatSection}>
          <ChatPanel onSendMessage={(msg, type, url, filename) => {
            if (!type && !url) {
              const command = msg.trim().toLowerCase();
              if (command.startsWith('/')) {
                if (command === '/clear') {
                  socket.emit('music_action', 'clear');
                  return;
                } else if (command === '/skip') {
                  socket.emit('music_action', 'skip');
                  return;
                } else if (command === '/pause') {
                  socket.emit('music_action', 'pause');
                  return;
                } else if (command === '/play') {
                  socket.emit('music_action', 'play');
                  return;
                } else {
                  store.addMessage({
                    id: `sys-${Date.now()}`,
                    userName: 'Sistema',
                    message: 'Comando não reconhecido. Comandos válidos: /clear, /skip, /pause, /play',
                    timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    isSystem: true,
                    type: 'text'
                  });
                  return;
                }
              }
            }
            socket.emit('send_message', msg, type, url, filename);
          }} />
        </div>

        <div className={styles.sidePanels}>
          <MusicPanel
            onRequestMusic={(url) => socket.emit('request_music', url)}
            onRemoveFromQueue={(token) => socket.emit('remove_from_queue', token)}
            onReorderQueue={(oldIndex, newIndex) => socket.emit('reorder_queue', oldIndex, newIndex)}
            inVoice={store.inVoice}
          />
          <AudioControls onUnlockAudio={yt.unlock} />
        </div>
      </main>

      <ScreenSharePanel 
        onClose={() => store.setScreenShare(null)} 
        onStopSharing={screenShare.stopScreenShare}
      />
      
      <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
        <StatusBar />
      </div>
    </div>
  );
}
