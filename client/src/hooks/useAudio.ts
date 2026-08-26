import { useCallback } from 'react';
import { useAudioStore } from '../stores/useAudioStore';

interface AudioNodes {
  ctx: AudioContext;
  micSource: MediaStreamAudioSourceNode;
  micGain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
  // Advanced noise suppression nodes
  highpass: BiquadFilterNode | null;
  lowpass: BiquadFilterNode | null;
  noiseGateNode: AudioWorkletNode | null;
  compressor: DynamicsCompressorNode | null;
}

const speakingAnimations = new Map<string, number>();
const remoteGains = new Map<string, GainNode>();
const screenAudioGains = new Map<string, GainNode>();

let audioNodes: AudioNodes | null = null;
let micTrack: MediaStreamTrack | null = null;

let globalCtx: AudioContext | null = null;

function getOrCreateCtx(): AudioContext {
  if (!globalCtx || globalCtx.state === 'closed') {
    globalCtx = new AudioContext({ sampleRate: 48000 });
  }
  return globalCtx;
}

const loadedWorklets = new WeakSet<AudioContext>();

/**
 * Load the NoiseGateProcessor AudioWorklet module.
 * Returns true on success, false on failure (e.g. browser doesn't support worklets).
 */
async function loadNoiseGateWorklet(ctx: AudioContext): Promise<boolean> {
  if (loadedWorklets.has(ctx)) return true;
  try {
    await ctx.audioWorklet.addModule('/noise-gate-processor.js');
    loadedWorklets.add(ctx);
    return true;
  } catch (err) {
    console.warn('[useAudio] Failed to load noise-gate-processor worklet:', err);
    return false;
  }
}

export function useAudio() {

  const processMicStream = useCallback(async (rawStream: MediaStream): Promise<MediaStream> => {
    if (audioNodes) {
      audioNodes.micSource.disconnect();
      audioNodes.micGain.disconnect();
      audioNodes.highpass?.disconnect();
      audioNodes.lowpass?.disconnect();
      audioNodes.noiseGateNode?.disconnect();
      audioNodes.compressor?.disconnect();
      audioNodes.destination.disconnect();
      audioNodes.analyser.disconnect();
    }

    const ctx = getOrCreateCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const source = ctx.createMediaStreamSource(rawStream);
    const gainNode = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const { micVol, noiseSuppression, noiseGateThreshold } = useAudioStore.getState();
    gainNode.gain.value = micVol / 100;

    micTrack = rawStream.getAudioTracks()[0] ?? null;

    // ─── Build processing chain ────────────────────────────────────
    // Chain: source → highpass → lowpass → [noiseGate] → compressor → gainNode → analyser + dest
    let highpass: BiquadFilterNode | null = null;
    let lowpass: BiquadFilterNode | null = null;
    let noiseGateNode: AudioWorkletNode | null = null;
    let compressor: DynamicsCompressorNode | null = null;

    if (noiseSuppression) {
      // High-pass filter — removes low-frequency rumble (fans, AC, vibration)
      highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 200;
      highpass.Q.value = 0.7;

      // Low-pass filter — removes high-frequency hiss
      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000;
      lowpass.Q.value = 0.7;

      // Dynamics compressor — smooths out volume spikes
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;

      // Try loading AudioWorklet for noise gate
      const workletOk = await loadNoiseGateWorklet(ctx);
      if (workletOk) {
        noiseGateNode = new AudioWorkletNode(ctx, 'noise-gate-processor');
        const thresholdParam = noiseGateNode.parameters.get('threshold');
        if (thresholdParam) {
          thresholdParam.value = noiseGateThreshold;
        }
      }

      // Wire the chain: source → highpass → lowpass → [noiseGate] → compressor → gainNode
      source.connect(highpass);
      highpass.connect(lowpass);

      if (noiseGateNode) {
        lowpass.connect(noiseGateNode);
        noiseGateNode.connect(compressor);
      } else {
        lowpass.connect(compressor);
      }

      compressor.connect(gainNode);
    } else {
      // No suppression — direct path
      source.connect(gainNode);
    }

    gainNode.connect(dest);
    gainNode.connect(analyser);

    audioNodes = {
      ctx, micSource: source, micGain: gainNode,
      destination: dest, analyser,
      highpass, lowpass, noiseGateNode, compressor,
    };

    // Return the processed stream (from destination node) for WebRTC
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
      audioEl.play().catch(e => console.warn('[useAudio] Autoplay prevented:', e));

      // Reuse the active context for speaking detection so it isn't suspended
      const activeCtx = audioNodes?.ctx ?? getOrCreateCtx();
      
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
      const isLocalMuted = localMutedUsers.includes(userId);
      const targetVol = (callMuted || isLocalMuted) ? 0 : (screenShareVol / 100);

      audioEl.srcObject = stream;
      audioEl.volume = Math.min(1, targetVol);
      audioEl.muted = false;
      audioEl.play().catch(e => console.warn('[useAudio] Screen audio play prevented:', e));

      const activeCtx = audioNodes?.ctx ?? getOrCreateCtx();
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
          audioEl.muted = true; // Web Audio API handles playback with amplification up to 200%
        } catch (e) {
          audioEl.muted = false;
        }
      }

      if (gainNode) {
        gainNode.gain.value = targetVol;
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
      const targetVol = (callMuted || isLocalMuted) ? 0 : (screenShareVol / 100);

      const gainNode = screenAudioGains.get(userId);
      if (gainNode) {
        gainNode.gain.value = targetVol;
      } else {
        audio.volume = Math.min(1, targetVol);
        audio.muted = callMuted || isLocalMuted;
      }
    });

    screenAudioGains.forEach((gainNode, userId) => {
      const isLocalMuted = localMutedUsers.includes(userId);
      gainNode.gain.value = (callMuted || isLocalMuted) ? 0 : (screenShareVol / 100);
    });
  }, []);

  /**
   * Update noise gate threshold in real-time.
   * Called when the user adjusts the sensitivity slider.
   */
  const applyNoiseSuppressionSettings = useCallback(() => {
    if (!audioNodes?.noiseGateNode) return;
    const { noiseGateThreshold, noiseSuppression } = useAudioStore.getState();

    const thresholdParam = audioNodes.noiseGateNode.parameters.get('threshold');
    if (thresholdParam) {
      // When suppression is disabled, set threshold to minimum (effectively bypassing the gate)
      thresholdParam.value = noiseSuppression ? noiseGateThreshold : -100;
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
   * Cleanup all audio resources when leaving a call.
   * Stops the raw mic track, closes the AudioContext, and resets state
   * so that a fresh pipeline can be built on rejoin.
   */
  const cleanup = useCallback(() => {
    // Stop the raw microphone track so the browser releases the device
    if (micTrack) {
      micTrack.stop();
      micTrack = null;
    }

    screenAudioGains.forEach((gain) => gain.disconnect());
    screenAudioGains.clear();

    remoteGains.forEach((gain) => gain.disconnect());
    remoteGains.clear();

    // Disconnect and close the AudioContext
    if (audioNodes) {
      try {
        audioNodes.micSource.disconnect();
        audioNodes.micGain.disconnect();
        audioNodes.highpass?.disconnect();
        audioNodes.lowpass?.disconnect();
        audioNodes.noiseGateNode?.disconnect();
        audioNodes.compressor?.disconnect();
        audioNodes.destination.disconnect();
        audioNodes.analyser.disconnect();
        audioNodes.ctx.close();
      } catch (e) {
        // Ignore errors during teardown
      }
      audioNodes = null;
    }
    // Clear remote gains so next context doesn't try to use closed nodes
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
    getMicTrack: () => micTrack,
  };
}

// ─── SPEAKING DETECTION ─────────────────────────────────────────────

export function monitorSpeaking(stream: MediaStream, userId: string, activeCtx?: AudioContext) {
  const ctx = activeCtx || getOrCreateCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += Math.abs(v - 128);
    const avg = sum / data.length;

    const el = document.getElementById(`user-${userId}`);
    if (el) {
      if (avg > 8) el.classList.add('speaking-glow');
      else el.classList.remove('speaking-glow');
    }

    speakingAnimations.set(userId, requestAnimationFrame(tick));
  }

  tick();
}

export function stopSpeaking(userId: string) {
  const raf = speakingAnimations.get(userId);
  if (raf) cancelAnimationFrame(raf);
  speakingAnimations.delete(userId);

  const el = document.getElementById(`user-${userId}`);
  el?.classList.remove('speaking-glow');
}
