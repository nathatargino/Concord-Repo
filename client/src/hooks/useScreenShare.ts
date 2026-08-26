import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';

type EmitFn = (event: string, ...args: unknown[]) => void;

/**
 * Attempts to get a display media stream.
 * First tries with audio, falls back to video-only if that fails.
 */
async function acquireDisplayStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err: unknown) {
    // If the user explicitly cancelled, propagate immediately
    if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw err;
    }
    // Otherwise try without audio as fallback (some browsers reject audio+fullscreen)
    console.warn('[ScreenShare] getDisplayMedia with audio failed, retrying video-only:', err);
    return await navigator.mediaDevices.getDisplayMedia({ video: true });
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
      const stream = await acquireDisplayStream();

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
      const stream = await acquireDisplayStream();

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
