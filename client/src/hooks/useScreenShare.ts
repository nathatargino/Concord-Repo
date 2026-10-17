import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
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

  let targetWidth = 1920;
  let targetHeight = 1080;
  if (screenShareResolution === '720p') {
    targetWidth = 1280;
    targetHeight = 720;
  } else if (screenShareResolution === '1440p') {
    targetWidth = 2560;
    targetHeight = 1440;
  }

  // W3C Screen Capture spec forbids 'max' or 'exact' in initial getDisplayMedia() options;
  // use 'ideal' in getDisplayMedia() and apply 'max' post-capture via track.applyConstraints().
  const idealVideoConstraints: MediaTrackConstraints = {
    width: { ideal: targetWidth },
    height: { ideal: targetHeight },
    frameRate: { ideal: screenShareFps },
  };

  const applyHintsAndConstraints = async (stream: MediaStream): Promise<MediaStream> => {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        // @ts-ignore
        videoTrack.contentHint = screenShareContentHint;
      } catch {}
      try {
        await videoTrack.applyConstraints({
          width: { ideal: targetWidth, max: targetWidth },
          height: { ideal: targetHeight, max: targetHeight },
          frameRate: { ideal: screenShareFps, max: screenShareFps },
        });
      } catch {
        try {
          await videoTrack.applyConstraints({
            frameRate: { ideal: screenShareFps },
          });
        } catch {}
      }
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = true;
      try {
        // @ts-ignore
        audioTrack.contentHint = 'music';
      } catch {}
      try {
        await audioTrack.applyConstraints({
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        });
      } catch {}
    }
    return stream;
  };

  if (isElectron) {
    if (withAudio) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        return await applyHintsAndConstraints(stream);
      } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
          throw err;
        }
        console.warn(`[ScreenShare] Electron screen share with audio failed (${err?.name}: ${err?.message}), attempting video-only fallback...`);
        try {
          const fallbackVideoOnly = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          toast('⚠️ Áudio do sistema indisponível no dispositivo. Transmitindo apenas vídeo.', { icon: '⚠️', duration: 4000 });
          return await applyHintsAndConstraints(fallbackVideoOnly);
        } catch (fbErr: any) {
          throw fbErr;
        }
      }
    } else {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      return await applyHintsAndConstraints(stream);
    }
  }

  // Browser capture (Discord Web style)
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: idealVideoConstraints,
      audio: withAudio ? {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        // @ts-ignore
        suppressLocalAudioPlayback: false,
      } : false,
      systemAudio: withAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    } as any);
    return await applyHintsAndConstraints(stream);
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      throw err;
    }
    try {
      const fallbackStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: withAudio,
        systemAudio: withAudio ? 'include' : 'exclude',
      } as any);
      return await applyHintsAndConstraints(fallbackStream);
    } catch (err2: any) {
      if (err2?.name === 'NotAllowedError' || err2?.name === 'AbortError') {
        throw err2;
      }
      const fallbackVideoOnly = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      toast('⚠️ Áudio do sistema indisponível no navegador. Transmitindo apenas vídeo.', { icon: '⚠️', duration: 4000 });
      return await applyHintsAndConstraints(fallbackVideoOnly);
    }
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
    if (typeof window !== 'undefined' && (window as any).electron?.setModalActive) {
      (window as any).electron.setModalActive(false);
    }
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

      // Send native display/WASAPI loopback stream directly to WebRTC (avoids Chromium WebAudio MediaStreamSource silence bug)
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
  }, [emit, addScreenShareTrack, stopScreenShare]);

  const doChangeScreenShare = useCallback(async (withAudio: boolean = true) => {
    if (isRequestingRef.current) return;
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia(withAudio);

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;

      // Send native display/WASAPI loopback stream directly to WebRTC
      addScreenShareTrack(stream);

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
  }, [addScreenShareTrack, stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    if (isRequestingRef.current || useAppStore.getState().amSharing) {
      return;
    }

    const isElectron = typeof window !== 'undefined' && (/electron/i.test(navigator.userAgent) || !!(window as any).electron);
    if (isElectron) {
      isChangingRef.current = false;
      (window as any).electron?.setModalActive?.(true);
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
      (window as any).electron?.setModalActive?.(true);
      setIsPickerOpen(true);
      return;
    }

    await doChangeScreenShare(true);
  }, [doChangeScreenShare]);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    if (typeof window !== 'undefined' && (window as any).electron?.setModalActive) {
      (window as any).electron.setModalActive(false);
    }
    isChangingRef.current = false;
    isRequestingRef.current = false;
  }, []);

  const confirmPicker = useCallback(async (sourceId: string, withAudio: boolean) => {
    setIsPickerOpen(false);
    if (typeof window !== 'undefined' && (window as any).electron?.setModalActive) {
      (window as any).electron.setModalActive(false);
    }
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

