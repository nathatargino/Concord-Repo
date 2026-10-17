import { useState, useCallback, useRef, useEffect } from 'react';
import { notifyInChat } from '../utils/systemMessage';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { EchoFilter } from '../utils/echoFilter';

type EmitFn = (event: string, ...args: unknown[]) => void;
type GetRemoteStreamsFn = () => Map<string, MediaStream>;

/** Helper function to request display media with resolution, FPS, and contentHint */
async function captureDisplayMedia(withAudio: boolean = true): Promise<MediaStream> {
  const isElectron = typeof window !== 'undefined' && (/electron/i.test(navigator.userAgent) || !!(window as any).electron);
  const { screenShareResolution, screenShareFps, screenShareContentHint } = useAudioStore.getState();

  let widthConstraints = { ideal: 1920, max: 1920 };
  let heightConstraints = { ideal: 1080, max: 1080 };
  if (screenShareResolution === '720p') {
    widthConstraints = { ideal: 1280, max: 1280 };
    heightConstraints = { ideal: 720, max: 720 };
  } else if (screenShareResolution === '1440p') {
    widthConstraints = { ideal: 2560, max: 2560 };
    heightConstraints = { ideal: 1440, max: 1440 };
  }

  const videoConstraintsWithRes: MediaTrackConstraints = {
    width: widthConstraints,
    height: heightConstraints,
    frameRate: { ideal: screenShareFps, max: screenShareFps },
  };

  const videoConstraintsFallback: MediaTrackConstraints = {
    frameRate: { ideal: screenShareFps, max: screenShareFps },
  };

  const applyHints = (stream: MediaStream): MediaStream => {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      // @ts-ignore
      videoTrack.contentHint = screenShareContentHint;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      // @ts-ignore
      audioTrack.contentHint = 'music';
    }
    return stream;
  };

  if (isElectron) {
    if (withAudio) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraintsWithRes,
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
        });
        return applyHints(stream);
      } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
          throw err;
        }
        console.warn(`[ScreenShare] Electron screen share with resolution constraints failed, trying fallback:`, err);
        try {
          const fallbackWithAudio = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraintsFallback,
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            },
          });
          return applyHints(fallbackWithAudio);
        } catch {
          const fallbackVideoOnly = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraintsFallback,
            audio: false,
          });
          notifyInChat('⚠️ Áudio do sistema indisponível no dispositivo de som. Transmitindo apenas vídeo.');
          return applyHints(fallbackVideoOnly);
        }
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraintsWithRes,
          audio: false,
        });
        return applyHints(stream);
      } catch {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraintsFallback,
          audio: false,
        });
        return applyHints(stream);
      }
    }
  }

  // Browser capture
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraintsWithRes,
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
    return applyHints(stream);
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      throw err;
    }
    try {
      const fallbackStream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraintsFallback,
        audio: withAudio ? {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        } : false,
      } as any);
      return applyHints(fallbackStream);
    } catch {
      const fallbackVideoOnly = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraintsFallback,
        audio: false,
      });
      notifyInChat('⚠️ Áudio do sistema indisponível no navegador. Transmitindo apenas vídeo.');
      return applyHints(fallbackVideoOnly);
    }
  }
}

export function useScreenShare(
  emit: EmitFn,
  addScreenShareTrack: (stream: MediaStream) => void,
  removeScreenShareTrack: () => void,
  getRemoteAudioStreams?: GetRemoteStreamsFn,
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

  /**
   * Process the loopback audio through the echo filter so that remote
   * participants' voices (playing through the speakers) are subtracted
   * from the captured audio before it is sent via WebRTC.
   */
  const filterLoopbackEcho = useCallback((stream: MediaStream): MediaStream => {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return stream;

      disposeEchoFilter();

      const filter = new EchoFilter();
      const remoteStreams = getRemoteAudioStreams ? getRemoteAudioStreams() : new Map();
      const cleanTrack = filter.start(audioTrack, remoteStreams);
      echoFilterRef.current = filter;

      if (cleanTrack && cleanTrack !== audioTrack) {
        const filtered = new MediaStream();
        stream.getVideoTracks().forEach((t) => filtered.addTrack(t));
        filtered.addTrack(cleanTrack);
        return filtered;
      }

      return stream;
    } catch (err) {
      console.warn('[ScreenShare] Error in filterLoopbackEcho, using raw stream:', err);
      return stream;
    }
  }, [getRemoteAudioStreams, disposeEchoFilter]);

  // Keep active echo filter synced with newly joined/speaking remote peers in real-time
  useEffect(() => {
    if (!getRemoteAudioStreams) return;
    const interval = setInterval(() => {
      if (echoFilterRef.current && getRemoteAudioStreams) {
        const remoteStreams = getRemoteAudioStreams();
        echoFilterRef.current.updateRemoteStreams(remoteStreams);
      }
    }, 1200);
    return () => clearInterval(interval);
  }, [getRemoteAudioStreams]);

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
    notifyInChat('🖥️ Compartilhamento de tela encerrado');
  }, [emit, removeScreenShareTrack, disposeEchoFilter]);

  const doStartScreenShare = useCallback(async (withAudio: boolean = true) => {
    if (isRequestingRef.current || useAppStore.getState().amSharing) {
      return;
    }
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia(withAudio);
      streamRef.current = stream;

      // Filter echo from the loopback audio before sending via WebRTC
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

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
        notifyInChat('🖥️ Compartilhando tela com áudio!');
      } else {
        notifyInChat('🖥️ Compartilhando tela sem áudio');
      }
    } catch (err: unknown) {
      // NotAllowedError / AbortError = usuário cancelou o picker → silencioso
      if (err instanceof Error) {
        if (err.name === 'NotReadableError') {
          notifyInChat('Erro no compartilhamento com áudio. Tente compartilhar sem som.');
        } else if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          notifyInChat('Erro ao compartilhar tela');
        }
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.error('[ScreenShare] startScreenShare error:', err);
        }
      }
    } finally {
      isRequestingRef.current = false;
    }
  }, [emit, filterLoopbackEcho, addScreenShareTrack, stopScreenShare]);

  const doChangeScreenShare = useCallback(async (withAudio: boolean = true) => {
    if (isRequestingRef.current) return;
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia(withAudio);

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;

      // Re-apply echo filter for the new stream
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

      // Listen for user stopping via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      notifyInChat('🖥️ Transmissão de tela alterada!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        notifyInChat('Erro ao trocar tela');
        console.error('[ScreenShare] changeScreenShare error:', err);
      }
    } finally {
      isRequestingRef.current = false;
    }
  }, [filterLoopbackEcho, addScreenShareTrack, stopScreenShare]);

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

