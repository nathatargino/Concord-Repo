import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { EchoFilter } from '../utils/echoFilter';

type EmitFn = (event: string, ...args: unknown[]) => void;
type GetRemoteStreamsFn = () => Map<string, MediaStream>;

/** Helper function to request display media (opens picker once with video-only fallback if audio fails) */
async function captureDisplayMedia(withAudio: boolean = true): Promise<MediaStream> {
  const isElectron = typeof window !== 'undefined' && (/electron/i.test(navigator.userAgent) || !!(window as any).electron);

  if (isElectron) {
    if (withAudio) {
      // In Electron on Windows, system audio loopback requires disabling AEC, NS and AGC,
      // because WASAPI loopback is not a microphone and will fail if audio processing is applied.
      try {
        return await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
          },
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
        });
      } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
          throw err;
        }
        console.warn(`[ScreenShare] Electron screen share with audio failed (name=${err?.name}, msg=${err?.message}):`, err);
        const fallbackStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        });
        toast('⚠️ Áudio do sistema indisponível no dispositivo de som. Transmitindo apenas vídeo.', {
          icon: '⚠️',
          duration: 4000,
        });
        return fallbackStream;
      }
    } else {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
    }
  }

  // Browser capture
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
      },
      audio: withAudio ? {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      } : false,
      systemAudio: withAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    } as any);
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      throw err;
    }
    // If browser audio capture failed with NotReadableError (e.g. system audio blocked by Windows)
    if (err?.name === 'NotReadableError') {
      console.warn(`[ScreenShare] Browser audio capture failed with NotReadableError (name=${err?.name}, msg=${err?.message}):`, err);
      try {
        const fallbackStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        });
        toast('⚠️ Áudio do sistema indisponível no navegador. Transmitindo apenas vídeo.', {
          icon: '⚠️',
          duration: 4000,
        });
        return fallbackStream;
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

export function useScreenShare(
  emit: EmitFn,
  addScreenShareTrack: (stream: MediaStream) => void,
  removeScreenShareTrack: () => void,
  _getRemoteAudioStreams?: GetRemoteStreamsFn,
) {
  const streamRef = useRef<MediaStream | null>(null);
  const echoFilterRef = useRef<EchoFilter | null>(null);
  const isRequestingRef = useRef<boolean>(false); // Trava contra cliques duplos / chamadas concorrentes
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const isChangingRef = useRef<boolean>(false);

  /** Dispose any active echo filter */
  const disposeEchoFilter = useCallback(() => {
    try {
      echoFilterRef.current?.dispose();
    } catch (e) {
      console.warn('[ScreenShare] Error disposing echo filter:', e);
    }
    echoFilterRef.current = null;
  }, []);

  const stopScreenShare = useCallback(() => {
    isRequestingRef.current = false;
    isChangingRef.current = false;
    setIsPickerOpen(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    disposeEchoFilter();
    removeScreenShareTrack();
    emit('stop_screen_share');
    useAppStore.getState().setAmSharing(false);
    playScreenShareStopSound();
    toast('🖥️ Compartilhamento encerrado', { duration: 2000 });
  }, [emit, removeScreenShareTrack, disposeEchoFilter]);

  const doStartScreenShare = useCallback(async (withAudio: boolean = true) => {
    if (isRequestingRef.current || useAppStore.getState().amSharing) {
      return;
    }
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia(withAudio);
      streamRef.current = stream;

      // Send the high-fidelity loopback audio track directly through WebRTC
      addScreenShareTrack(stream);

      emit('start_screen_share');
      useAppStore.getState().setAmSharing(true);
      playScreenShareStartSound();

      // Listen for user stopping via browser UI (e.g. Chrome's "Stop sharing" floating bar)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      const hasAudio = stream.getAudioTracks().length > 0;
      if (hasAudio) {
        toast.success('🖥️ Compartilhando tela com áudio!');
      } else {
        toast('🖥️ Compartilhando tela sem áudio', {
          icon: '🖥️',
          duration: 3500,
        });
      }
    } catch (err: unknown) {
      // NotAllowedError / AbortError = usuário cancelou o picker → silencioso
      if (err instanceof Error) {
        if (err.name === 'NotReadableError') {
          toast.error('Erro no compartilhamento com áudio. Tente compartilhar sem som.');
        } else if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          toast.error('Erro ao compartilhar tela');
        }
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.error('[ScreenShare] startScreenShare error:', err);
        }
      }
    } finally {
      isRequestingRef.current = false;
    }
  }, [emit, addScreenShareTrack, stopScreenShare]);

  const doChangeScreenShare = useCallback(async (withAudio: boolean = true) => {
    if (isRequestingRef.current) return;
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia(withAudio);

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;

      // Send the new stream directly through WebRTC
      addScreenShareTrack(stream);

      // Listen for user stopping via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      toast.success('🖥️ Transmissão de tela alterada!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao trocar tela');
        console.error('[ScreenShare] changeScreenShare error:', err);
      }
    } finally {
      isRequestingRef.current = false;
    }
  }, [addScreenShareTrack, stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    if (isRequestingRef.current || useAppStore.getState().amSharing) {
      return;
    }

    const isElectron = typeof window !== 'undefined' && (/electron/i.test(navigator.userAgent) || !!(window as any).electron);
    if (isElectron) {
      isChangingRef.current = false;
      setIsPickerOpen(true);
      return;
    }

    await doStartScreenShare(true);
  }, [doStartScreenShare]);

  const changeScreenShare = useCallback(async () => {
    if (isRequestingRef.current) return;

    const isElectron = typeof window !== 'undefined' && (/electron/i.test(navigator.userAgent) || !!(window as any).electron);
    if (isElectron) {
      isChangingRef.current = true;
      setIsPickerOpen(true);
      return;
    }

    await doChangeScreenShare(true);
  }, [doChangeScreenShare]);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    isChangingRef.current = false;
    isRequestingRef.current = false;
  }, []);

  const confirmPicker = useCallback(async (sourceId: string, withAudio: boolean) => {
    setIsPickerOpen(false);
    try {
      if (typeof window !== 'undefined' && (window as any).electron?.selectScreenSource) {
        await (window as any).electron.selectScreenSource({ sourceId, withAudio });
      }
      if (isChangingRef.current) {
        await doChangeScreenShare(withAudio);
      } else {
        await doStartScreenShare(withAudio);
      }
    } finally {
      isChangingRef.current = false;
    }
  }, [doStartScreenShare, doChangeScreenShare]);

  return {
    startScreenShare,
    stopScreenShare,
    changeScreenShare,
    streamRef,
    isPickerOpen,
    closePicker,
    confirmPicker,
  };
}

