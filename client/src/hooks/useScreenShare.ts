import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';

type EmitFn = (event: string, ...args: unknown[]) => void;

export function useScreenShare(emit: EmitFn, addScreenShareTrack: (stream: MediaStream) => void, removeScreenShareTrack: () => void) {
  const streamRef = useRef<MediaStream | null>(null);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          // Use large ideal values so the browser captures the native resolution
          // of any monitor (including ultrawide 3440x1440, super ultrawide 5120x1440, 4K, etc.)
          width: { ideal: 4096 },
          height: { ideal: 2160 },
          // @ts-ignore — cursor is valid but not in all TS typings
          cursor: 'always',
        },
        audio: true, // capture system audio if user allows
      });

      streamRef.current = stream;
      addScreenShareTrack(stream);

      emit('start_screen_share');
      useAppStore.getState().setAmSharing(true);
      playScreenShareStartSound();

      // Listen for user stopping via browser UI
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      toast.success('🖥️ Compartilhamento de tela iniciado!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        toast.error('Erro ao compartilhar tela');
        console.error(err);
      }
    }
  }, [emit, addScreenShareTrack]);

  const stopScreenShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    removeScreenShareTrack();
    emit('stop_screen_share');
    useAppStore.getState().setAmSharing(false);
    useAppStore.getState().setScreenShare(null, null);
    playScreenShareStopSound();
    toast('🖥️ Compartilhamento encerrado', { duration: 2000 });
  }, [emit, removeScreenShareTrack]);

  return { startScreenShare, stopScreenShare, streamRef };
}
