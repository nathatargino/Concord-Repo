import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';

type EmitFn = (event: string, ...args: unknown[]) => void;

async function getMediaDisplayStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: true,
    });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw err;
    }
    // Fallback with standard constraints if specific resolution + audio caused constraint rejection
    return await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  }
}

export function useScreenShare(emit: EmitFn, addScreenShareTrack: (stream: MediaStream) => void, removeScreenShareTrack: () => void) {
  const streamRef = useRef<MediaStream | null>(null);

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

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await getMediaDisplayStream();

      streamRef.current = stream;
      addScreenShareTrack(stream);

      emit('start_screen_share');
      useAppStore.getState().setAmSharing(true);
      playScreenShareStartSound();

      // Listen for user stopping via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopScreenShare();
      });

      toast.success('🖥️ Compartilhamento de tela iniciado!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao compartilhar tela');
        console.error('[ScreenShare] startScreenShare error:', err);
      }
    }
  }, [emit, addScreenShareTrack, stopScreenShare]);

  const changeScreenShare = useCallback(async () => {
    try {
      const stream = await getMediaDisplayStream();

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      addScreenShareTrack(stream);

      // Listen for user stopping via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopScreenShare();
      });

      toast.success('🖥️ Transmissão de tela alterada!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao trocar tela');
        console.error('[ScreenShare] changeScreenShare error:', err);
      }
    }
  }, [addScreenShareTrack, stopScreenShare]);

  return { startScreenShare, stopScreenShare, changeScreenShare, streamRef };
}
