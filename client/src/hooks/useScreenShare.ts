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
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
