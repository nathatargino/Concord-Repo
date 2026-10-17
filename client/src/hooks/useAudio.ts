import { useCallback } from 'react';
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { useAudioStore } from '../stores/useAudioStore';
import { useAppStore } from '../stores/useAppStore';

interface AudioNodes {
  ctx: AudioContext;
  micSource: MediaStreamAudioSourceNode;
  micGain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
  // Advanced noise suppression & dynamics nodes
  highpass: BiquadFilterNode;
  presenceEq: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  noiseGateNode: AudioWorkletNode | null;
  rnnoiseNode: RnnoiseWorkletNode | null;
  activeMode?: 'rnnoise' | 'standard' | 'off';
}

const speakingAnimations = new Map<string, number>();
const remoteGains = new Map<string, GainNode>();
const screenAudioGains = new Map<string, GainNode>();

let audioNodes: AudioNodes | null = null;
let micTrack: MediaStreamTrack | null = null;
let globalCtx: AudioContext | null = null;

let rnnoiseWasmBinary: ArrayBuffer | null = null;
const rnnoiseModulesLoaded = new WeakSet<AudioContext>();
const loadedWorklets = new WeakSet<AudioContext>();

/**
 * Instantiates or reuses the global AudioContext at 48kHz for Opus/WebRTC and RNNoise.
 */
export function getAudioContext(): AudioContext {
  if (!globalCtx || globalCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    try {
      globalCtx = new AudioContextClass({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch {
      globalCtx = new AudioContextClass();
    }
  }
  return globalCtx;
}

export const getOrCreateCtx = getAudioContext;

/**
 * Loads and caches the RNNoise WASM binary (SIMD with scalar fallback).
 */
async function getOrLoadRnnoiseBinary(): Promise<ArrayBuffer> {
  if (!rnnoiseWasmBinary) {
    rnnoiseWasmBinary = await loadRnnoise({
      url: rnnoiseWasmUrl,
      simdUrl: rnnoiseSimdWasmUrl,
    });
  }
  return rnnoiseWasmBinary;
}

/**
 * Initializes an instance of RnnoiseWorkletNode for the given context.
 */
async function initRnnoise(ctx: AudioContext): Promise<RnnoiseWorkletNode | null> {
  try {
    if (!rnnoiseModulesLoaded.has(ctx)) {
      await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
      rnnoiseModulesLoaded.add(ctx);
    }
    const wasmBinary = await getOrLoadRnnoiseBinary();
    return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  } catch (err) {
    console.warn('[useAudio] Falha ao inicializar RnnoiseWorkletNode:', err);
    return null;
  }
}

/**
 * Loads the custom NoiseGateProcessor AudioWorklet module.
 */
async function loadNoiseGateWorklet(ctx: AudioContext): Promise<boolean> {
  if (loadedWorklets.has(ctx)) return true;
  try {
    await ctx.audioWorklet.addModule('/noise-gate-processor.js');
    loadedWorklets.add(ctx);
    return true;
  } catch (err) {
    console.warn('[useAudio] Falha ao carregar worklet noise-gate-processor:', err);
    return false;
  }
}

/**
 * Dynamically re-wires audio nodes according to selected mode:
 * - 'rnnoise': Source -> HighPass(80Hz) -> RnnoiseWorkletNode -> NoiseGateWorklet -> PresenceEQ -> LowPass(14kHz) -> Compressor -> MicGain -> Destination
 * - 'standard': Source -> HighPass(80Hz) -> NoiseGateWorklet -> PresenceEQ -> LowPass(14kHz) -> Compressor -> MicGain -> Destination
 * - 'off': Source -> MicGain -> Destination
 */
function connectTopology(
  nodes: AudioNodes,
  mode: 'rnnoise' | 'standard' | 'off',
  autoSensitivity: boolean,
  threshold: number,
  forceRewire = false
) {
  const { micSource, micGain, highpass, presenceEq, lowpass, compressor, noiseGateNode, rnnoiseNode } = nodes;

  // 1. Atualizar parâmetros do Noise Gate em tempo real (sem desconectar nós)
  if (noiseGateNode) {
    const thresholdParam = noiseGateNode.parameters.get('threshold');
    const enabledParam = noiseGateNode.parameters.get('enabled');
    const autoSensParam = noiseGateNode.parameters.get('autoSensitivity');

    if (thresholdParam) thresholdParam.value = threshold;
    if (enabledParam) enabledParam.value = mode !== 'off' ? 1 : 0;
    if (autoSensParam) autoSensParam.value = autoSensitivity ? 1 : 0;

    noiseGateNode.port.postMessage({
      floorGain: mode === 'rnnoise' ? 0.02 : 0.005,
    });
  }

  // Se a topologia já está conectada neste modo, não reconecta os nós para evitar cliques no áudio
  if (!forceRewire && nodes.activeMode === mode) {
    return;
  }

  // 2. Desconectar cadeia intermediária de processamento
  try { micSource.disconnect(); } catch {}
  try { highpass.disconnect(); } catch {}
  try { rnnoiseNode?.disconnect(); } catch {}
  try { noiseGateNode?.disconnect(); } catch {}
  try { presenceEq.disconnect(); } catch {}
  try { lowpass.disconnect(); } catch {}
  try { compressor.disconnect(); } catch {}

  // 3. Conectar grafo conforme topologia
  if (mode === 'rnnoise' && rnnoiseNode) {
    micSource.connect(highpass);
    highpass.connect(rnnoiseNode);

    if (noiseGateNode) {
      rnnoiseNode.connect(noiseGateNode);
      noiseGateNode.connect(presenceEq);
    } else {
      rnnoiseNode.connect(presenceEq);
    }

    presenceEq.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(micGain);
  } else if (mode === 'standard' || (mode === 'rnnoise' && !rnnoiseNode)) {
    micSource.connect(highpass);

    if (noiseGateNode) {
      highpass.connect(noiseGateNode);
      noiseGateNode.connect(presenceEq);
    } else {
      highpass.connect(presenceEq);
    }

    presenceEq.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(micGain);
  } else {
    // Modo 'off': bypass limpo direto ao controle de ganho
    micSource.connect(micGain);
  }

  nodes.activeMode = mode;
}

export function useAudio() {
  const processMicStream = useCallback(async (rawStream: MediaStream): Promise<MediaStream> => {
    if (audioNodes) {
      try {
        audioNodes.micSource.disconnect();
        audioNodes.micGain.disconnect();
        audioNodes.highpass.disconnect();
        audioNodes.presenceEq.disconnect();
        audioNodes.lowpass.disconnect();
        audioNodes.compressor.disconnect();
        audioNodes.noiseGateNode?.disconnect();
        if (audioNodes.rnnoiseNode) {
          try { audioNodes.rnnoiseNode.destroy(); } catch {}
          audioNodes.rnnoiseNode.disconnect();
        }
        audioNodes.destination.disconnect();
        audioNodes.analyser.disconnect();
      } catch {}
    }

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createMediaStreamSource(rawStream);
    const gainNode = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const {
      micVol,
      micMuted,
      noiseSuppression,
      noiseSuppressionMode,
      noiseGateThreshold,
      autoSensitivity,
    } = useAudioStore.getState();

    gainNode.gain.value = micMuted ? 0 : micVol / 100;

    micTrack = rawStream.getAudioTracks()[0] ?? null;
    if (micTrack) {
      micTrack.enabled = !micMuted;
    }

    // ─── Criação da Cadeia de Filtros e Dinâmica ───────────────────
    // 1. High-Pass Filter em 80 Hz (Q = 0.707) - preserva o corpo e calor natural da voz humana (85-200 Hz)
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.707;

    // 2. Presence Peaking Filter suave em 2800 Hz (gain = +1.5 dB, Q = 1.0) para nitidez vocal cristalina
    const presenceEq = ctx.createBiquadFilter();
    presenceEq.type = 'peaking';
    presenceEq.frequency.value = 2800;
    presenceEq.gain.value = 1.5;
    presenceEq.Q.value = 1.0;

    // 3. Low-Pass Filter em 14000 Hz (Q = 0.707) - elimina chiado ultrassônico preservando o ar da voz
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 14000;
    lowpass.Q.value = 0.707;

    // 4. Dynamics Compressor estilo Broadcast Discord
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    // 5. Inicialização paralela de RNNoise e NoiseGateWorklet
    const [rnnoiseNode, workletOk] = await Promise.all([
      initRnnoise(ctx),
      loadNoiseGateWorklet(ctx),
    ]);

    let noiseGateNode: AudioWorkletNode | null = null;
    if (workletOk) {
      noiseGateNode = new AudioWorkletNode(ctx, 'noise-gate-processor');
    }

    // Saída final do ganho para o destino WebRTC e analisador de volume
    gainNode.connect(dest);
    gainNode.connect(analyser);

    dest.stream.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });

    audioNodes = {
      ctx,
      micSource: source,
      micGain: gainNode,
      destination: dest,
      analyser,
      highpass,
      presenceEq,
      lowpass,
      compressor,
      noiseGateNode,
      rnnoiseNode,
    };

    const effectiveMode: 'rnnoise' | 'standard' | 'off' =
      !noiseSuppression || noiseSuppressionMode === 'off' ? 'off' : noiseSuppressionMode;

    connectTopology(audioNodes, effectiveMode, autoSensitivity, noiseGateThreshold);

    return dest.stream;
  }, []);

  const attachRemoteStream = useCallback((audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => {
    try {
      const { remoteVol, callMuted, localMutedUsers, userVolumes } = useAudioStore.getState();
      const userVol = userVolumes[userId] ?? 100;

      const isLocalMuted = localMutedUsers.includes(userId);
      audioEl.srcObject = stream;
      audioEl.volume = 0; // Controlled by Web Audio API GainNode instead
      audioEl.muted = true;

      // Force play to overcome some browser policies
      audioEl.play().catch((e) => console.warn('[useAudio] Autoplay prevented:', e));

      // Reuse the active context for speaking detection so it isn't suspended
      const activeCtx = audioNodes?.ctx ?? getAudioContext();

      if (activeCtx.state === 'suspended') {
        activeCtx.resume();
      }

      let gainNode = remoteGains.get(userId);
      if (!gainNode) {
        const source = activeCtx.createMediaStreamSource(stream);
        gainNode = activeCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(activeCtx.destination);
        remoteGains.set(userId, gainNode);
      }

      gainNode.gain.value = (callMuted || isLocalMuted) ? 0 : (remoteVol / 100) * (userVol / 100);

      monitorSpeaking(stream, userId, activeCtx);
    } catch (err) {
      console.warn('[useAudio] attachRemoteStream failed', err);
    }
  }, []);

  const attachRemoteScreenAudio = useCallback((audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => {
    try {
      const { screenShareVol, callMuted, localMutedUsers } = useAudioStore.getState();
      const currentWatchingId = useAppStore.getState().screenShareUserId;
      const isWatching = currentWatchingId === userId;
      const isLocalMuted = localMutedUsers.includes(userId);
      const targetVol = (callMuted || isLocalMuted || !isWatching) ? 0 : (screenShareVol / 100);

      audioEl.srcObject = stream;
      audioEl.volume = Math.min(1, Math.max(0, targetVol));
      audioEl.muted = (callMuted || isLocalMuted || !isWatching || targetVol === 0);

      if (isWatching && targetVol > 0) {
        audioEl.play().catch((e) => console.warn('[useAudio] Screen audio play prevented:', e));
      } else {
        audioEl.pause();
      }

      // Boost (> 100% volume) via Web Audio API
      if (targetVol > 1 && isWatching) {
        const activeCtx = audioNodes?.ctx ?? getAudioContext();
        if (activeCtx.state === 'suspended') {
          activeCtx.resume().catch(() => {});
        }
        let gainNode = screenAudioGains.get(userId);
        if (!gainNode) {
          try {
            const source = activeCtx.createMediaStreamSource(stream);
            gainNode = activeCtx.createGain();
            source.connect(gainNode);
            gainNode.connect(activeCtx.destination);
            screenAudioGains.set(userId, gainNode);
            audioEl.muted = true;
          } catch (e) {
            audioEl.muted = false;
          }
        }
        if (gainNode) {
          gainNode.gain.value = targetVol;
        }
      } else {
        const gainNode = screenAudioGains.get(userId);
        if (gainNode) {
          try { gainNode.disconnect(); } catch {}
          screenAudioGains.delete(userId);
        }
        audioEl.muted = (callMuted || isLocalMuted || !isWatching || targetVol === 0);
        audioEl.volume = Math.min(1, Math.max(0, targetVol));
      }
    } catch (err) {
      console.warn('[useAudio] attachRemoteScreenAudio failed', err);
    }
  }, []);

  const applyMicSettings = useCallback(() => {
    if (!audioNodes) return;
    const { micVol, micMuted } = useAudioStore.getState();
    audioNodes.micGain.gain.value = micMuted ? 0 : micVol / 100;
    if (micTrack) micTrack.enabled = !micMuted;
  }, []);

  const applyRemoteSettings = useCallback(() => {
    const { remoteVol, screenShareVol, callMuted, localMutedUsers, userVolumes } = useAudioStore.getState();
    const currentWatchingId = useAppStore.getState().screenShareUserId;

    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-audio-"]').forEach((audio) => {
      const userId = audio.id.replace('remote-audio-', '');
      const isLocalMuted = localMutedUsers.includes(userId);
      const userVol = userVolumes[userId] ?? 100;

      const gainNode = remoteGains.get(userId);
      if (gainNode) {
        gainNode.gain.value = (callMuted || isLocalMuted) ? 0 : (remoteVol / 100) * (userVol / 100);
      } else {
        audio.volume = isLocalMuted ? 0 : (remoteVol / 100);
        audio.muted = callMuted || isLocalMuted;
      }
    });

    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-screen-audio-"]').forEach((audio) => {
      const userId = audio.id.replace('remote-screen-audio-', '');
      const isLocalMuted = localMutedUsers.includes(userId);
      const isWatching = currentWatchingId === userId;
      const targetVol = (callMuted || isLocalMuted || !isWatching) ? 0 : (screenShareVol / 100);

      const gainNode = screenAudioGains.get(userId);
      if (gainNode) {
        gainNode.gain.value = targetVol;
      } else {
        audio.volume = Math.min(1, Math.max(0, targetVol));
        audio.muted = callMuted || isLocalMuted || !isWatching || targetVol === 0;
      }

      if (!isWatching || targetVol === 0) {
        audio.pause();
      } else if (audio.paused && targetVol > 0) {
        audio.play().catch(() => {});
      }
    });

    screenAudioGains.forEach((gainNode, userId) => {
      const isLocalMuted = localMutedUsers.includes(userId);
      const isWatching = currentWatchingId === userId;
      gainNode.gain.value = (callMuted || isLocalMuted || !isWatching) ? 0 : (screenShareVol / 100);
    });
  }, []);

  /**
   * Applies noise suppression mode, threshold, and auto-sensitivity settings dynamically in real-time.
   */
  const applyNoiseSuppressionSettings = useCallback(async () => {
    if (!audioNodes) return;
    const { noiseSuppression, noiseSuppressionMode, noiseGateThreshold, autoSensitivity } = useAudioStore.getState();

    const effectiveMode: 'rnnoise' | 'standard' | 'off' =
      !noiseSuppression || noiseSuppressionMode === 'off' ? 'off' : noiseSuppressionMode;

    const modeChanged = audioNodes.activeMode !== effectiveMode;

    if (effectiveMode === 'rnnoise' && !audioNodes.rnnoiseNode) {
      audioNodes.rnnoiseNode = await initRnnoise(audioNodes.ctx);
    }
    if (effectiveMode !== 'off' && !audioNodes.noiseGateNode) {
      const ok = await loadNoiseGateWorklet(audioNodes.ctx);
      if (ok) {
        audioNodes.noiseGateNode = new AudioWorkletNode(audioNodes.ctx, 'noise-gate-processor');
      }
    }

    connectTopology(audioNodes, effectiveMode, autoSensitivity, noiseGateThreshold);

    if (modeChanged && micTrack) {
      micTrack
        .applyConstraints({
          noiseSuppression: effectiveMode !== 'off',
          echoCancellation: true,
          autoGainControl: true,
        })
        .catch(() => {});
    }
  }, []);

  const removeRemoteGain = useCallback((userId: string) => {
    stopSpeaking(userId);
    const gain = remoteGains.get(userId);
    if (gain) {
      gain.disconnect();
      remoteGains.delete(userId);
    }
    const screenGain = screenAudioGains.get(userId);
    if (screenGain) {
      screenGain.disconnect();
      screenAudioGains.delete(userId);
    }
  }, []);

  /**
   * Clean up all audio processing resources when leaving a call.
   */
  const cleanup = useCallback(() => {
    if (micTrack) {
      micTrack.stop();
      micTrack = null;
    }

    screenAudioGains.forEach((gain) => gain.disconnect());
    screenAudioGains.clear();

    remoteGains.forEach((gain) => gain.disconnect());
    remoteGains.clear();

    if (audioNodes) {
      try {
        audioNodes.micSource.disconnect();
        audioNodes.micGain.disconnect();
        audioNodes.highpass.disconnect();
        audioNodes.presenceEq.disconnect();
        audioNodes.lowpass.disconnect();
        audioNodes.compressor.disconnect();
        audioNodes.noiseGateNode?.disconnect();

        if (audioNodes.rnnoiseNode) {
          try {
            audioNodes.rnnoiseNode.destroy();
          } catch (e) {
            console.debug('[useAudio] RNNoise destroy error:', e);
          }
          audioNodes.rnnoiseNode.disconnect();
        }

        audioNodes.destination.disconnect();
        audioNodes.analyser.disconnect();
        audioNodes.ctx.close();
      } catch (e) {
        // Ignore teardown errors
      }
      audioNodes = null;
    }
    remoteGains.clear();
  }, []);

  return {
    processMicStream,
    attachRemoteStream,
    attachRemoteScreenAudio,
    applyMicSettings,
    applyRemoteSettings,
    applyNoiseSuppressionSettings,
    removeRemoteGain,
    cleanup,
    cleanupMicProcessing: cleanup,
    getMicTrack: () => micTrack,
  };
}

// ─── SPEAKING DETECTION ─────────────────────────────────────────────

export function monitorSpeaking(stream: MediaStream, userId: string, activeCtx?: AudioContext) {
  if (speakingAnimations.has(userId)) {
    const prevRaf = speakingAnimations.get(userId);
    if (prevRaf) cancelAnimationFrame(prevRaf);
  }

  const ctx = activeCtx || getAudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  let smoothedVol = 0;
  let isSpeaking = false;
  let lastSpeakTime = 0;

  function tick() {
    const isMe = userId === useAppStore.getState().myId;
    const isMicMuted = useAudioStore.getState().micMuted;

    if (isMe && isMicMuted) {
      isSpeaking = false;
      smoothedVol = 0;
    } else {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += Math.abs(v - 128);
      const avg = sum / data.length;

      // Exponential Moving Average
      smoothedVol = smoothedVol * 0.6 + avg * 0.4;

      // Threshold calibrado para 2.5 (alta precisão para voz e headsets)
      if (smoothedVol > 2.5) {
        isSpeaking = true;
        lastSpeakTime = Date.now();
      } else if (isSpeaking && Date.now() - lastSpeakTime > 250) {
        isSpeaking = false;
      }
    }

    const elements = document.querySelectorAll(`[data-user-id="${userId}"], #user-${userId}`);
    elements.forEach((el) => {
      if (isSpeaking) {
        el.classList.add('speaking-glow');
      } else {
        el.classList.remove('speaking-glow');
      }
    });

    speakingAnimations.set(userId, requestAnimationFrame(tick));
  }

  tick();
}

export function stopSpeaking(userId: string) {
  const raf = speakingAnimations.get(userId);
  if (raf) cancelAnimationFrame(raf);
  speakingAnimations.delete(userId);

  const elements = document.querySelectorAll(`[data-user-id="${userId}"], #user-${userId}`);
  elements.forEach((el) => el.classList.remove('speaking-glow'));
}

export function playChimeSound() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    // Note 1 (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2 (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (err) {
    console.debug('Chime sound error:', err);
  }
}
