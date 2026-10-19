import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'concord_audio_v2';

export type NoiseSuppressionMode = 'rnnoise' | 'standard' | 'off';
export type ScreenShareResolution = '720p' | '1080p' | '1440p';
export type ScreenShareFps = 30 | 60;
export type ScreenShareContentHint = 'motion' | 'detail';

interface AudioState {
  ytVol: number;
  micVol: number;
  remoteVol: number;
  screenShareVol: number;
  micMuted: boolean;
  serverMuted: boolean;
  callMuted: boolean;
  selectedAudioInputId: string;
  selectedAudioOutputId: string;
  noiseSuppression: boolean;
  noiseSuppressionMode: NoiseSuppressionMode;
  autoSensitivity: boolean;
  noiseGateThreshold: number; // dBFS, range -80 to 0
  localMutedUsers: string[];
  userVolumes: Record<string, number>;

  // Screen share & global keybind settings
  screenShareResolution: ScreenShareResolution;
  screenShareFps: ScreenShareFps;
  screenShareContentHint: ScreenShareContentHint;
  keybindMicMute: string;
  keybindDeafen: string;
  keybindsEnabled: boolean;

  setYtVol: (v: number) => void;
  setMicVol: (v: number) => void;
  setRemoteVol: (v: number) => void;
  setScreenShareVol: (v: number) => void;
  setSelectedAudioInputId: (id: string) => void;
  setSelectedAudioOutputId: (id: string) => void;
  setNoiseSuppression: (v: boolean) => void;
  setNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
  setAutoSensitivity: (v: boolean) => void;
  setNoiseGateThreshold: (v: number) => void;
  toggleNoiseSuppression: () => void;
  setMicMuted: (v: boolean) => void;
  setServerMuted: (v: boolean) => void;
  setCallMuted: (v: boolean) => void;
  toggleMicMute: () => void;
  toggleCallMute: () => void;
  toggleLocalMuteUser: (userId: string) => void;
  setUserVolume: (userId: string, vol: number) => void;

  setScreenShareResolution: (res: ScreenShareResolution) => void;
  setScreenShareFps: (fps: ScreenShareFps) => void;
  setScreenShareContentHint: (hint: ScreenShareContentHint) => void;
  setKeybindMicMute: (key: string) => void;
  setKeybindDeafen: (key: string) => void;
  setKeybindsEnabled: (enabled: boolean) => void;

  resetAll: () => void;
}

const defaults = {
  ytVol: 50, // Default 50% for first-time users as requested
  micVol: 100,
  remoteVol: 100,
  screenShareVol: 50, // Sincronizado com ytVol (streaming)
  selectedAudioInputId: 'default',
  selectedAudioOutputId: 'default',
  micMuted: false,
  serverMuted: false,
  callMuted: false,
  noiseSuppression: true,
  noiseSuppressionMode: 'rnnoise' as NoiseSuppressionMode,
  autoSensitivity: true,
  noiseGateThreshold: -45, // Calibrated Discord-style default (-45 dBFS)
  localMutedUsers: [],
  userVolumes: {},

  screenShareResolution: '1080p' as ScreenShareResolution,
  screenShareFps: 60 as ScreenShareFps,
  screenShareContentHint: 'motion' as ScreenShareContentHint,
  keybindMicMute: 'CommandOrControl+Shift+M',
  keybindDeafen: 'CommandOrControl+Shift+D',
  keybindsEnabled: true,
};

function getInitialState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }
  try {
    const isMigrated = localStorage.getItem('concord_ns_v2_migrated') === 'true';
    const legacyThreshold = localStorage.getItem('concord_noise_gate_threshold');
    if (!isMigrated && legacyThreshold === '-30') {
      localStorage.setItem('concord_noise_gate_threshold', '-45');
      localStorage.setItem('concord_ns_v2_migrated', 'true');
    }

    const savedV2 = localStorage.getItem(STORAGE_KEY);
    if (savedV2) {
      const parsed = JSON.parse(savedV2);
      if (parsed?.state) {
        const loadedState = { ...defaults, ...parsed.state };

        // Automatic migration from -30 to -45
        if (!isMigrated && loadedState.noiseGateThreshold === -30) {
          loadedState.noiseGateThreshold = -45;
          localStorage.setItem('concord_ns_v2_migrated', 'true');
        }

        if (loadedState.noiseSuppressionMode === undefined) {
          loadedState.noiseSuppressionMode = loadedState.noiseSuppression ? 'rnnoise' : 'off';
        } else if (loadedState.noiseSuppression && loadedState.noiseSuppressionMode === 'off') {
          loadedState.noiseSuppressionMode = 'rnnoise';
        } else if (!loadedState.noiseSuppression && loadedState.noiseSuppressionMode !== 'off') {
          loadedState.noiseSuppression = true;
        }

        if (loadedState.autoSensitivity === undefined) {
          loadedState.autoSensitivity = true;
        }

        if (loadedState.ytVol !== undefined) {
          loadedState.screenShareVol = loadedState.ytVol;
        }

        return loadedState;
      }
    }
    // Migrate from v1 if v2 does not exist
    const savedV1 = localStorage.getItem('concord_audio_v1');
    if (savedV1) {
      const parsed = JSON.parse(savedV1);
      if (parsed?.state) {
        const migratedYtVol = parsed.state.ytVol === 80 ? 50 : (parsed.state.ytVol ?? 50);
        const loadedState = {
          ...defaults,
          ...parsed.state,
          ytVol: migratedYtVol,
          screenShareVol: migratedYtVol,
        };
        if (!isMigrated && loadedState.noiseGateThreshold === -30) {
          loadedState.noiseGateThreshold = -45;
          localStorage.setItem('concord_ns_v2_migrated', 'true');
        }
        return loadedState;
      }
    }
  } catch (e) {
    console.debug('Error reading audio store from localStorage:', e);
  }
  return defaults;
}

export async function applyAudioOutputDevice(deviceId: string) {
  const audioElements = document.querySelectorAll<HTMLAudioElement>('audio');
  for (const el of audioElements) {
    if (typeof (el as any).setSinkId === 'function') {
      try {
        await (el as any).setSinkId(deviceId === 'default' ? '' : deviceId);
      } catch (err) {
        console.warn('[Audio] Falha ao definir sinkId no elemento:', err);
      }
    }
  }
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      ...getInitialState(),
      setYtVol: (ytVol) => {
        const val = Math.min(100, Math.max(0, ytVol));
        set({ ytVol: val, screenShareVol: val });
      },
      setMicVol: (micVol) => set({ micVol: Math.min(200, Math.max(0, micVol)) }),
      setRemoteVol: (remoteVol) => set({ remoteVol: Math.min(200, Math.max(0, remoteVol)) }),
      setScreenShareVol: (screenShareVol) => {
        const val = Math.min(100, Math.max(0, screenShareVol));
        set({ screenShareVol: val, ytVol: val });
      },
      setSelectedAudioInputId: (selectedAudioInputId) => set({ selectedAudioInputId }),
      setSelectedAudioOutputId: (selectedAudioOutputId) => {
        set({ selectedAudioOutputId });
        applyAudioOutputDevice(selectedAudioOutputId);
      },
      setNoiseSuppression: (noiseSuppression) =>
        set((s) => ({
          noiseSuppression,
          noiseSuppressionMode: noiseSuppression
            ? (s.noiseSuppressionMode === 'off' ? 'rnnoise' : s.noiseSuppressionMode)
            : 'off',
        })),
      setNoiseSuppressionMode: (mode) =>
        set({
          noiseSuppressionMode: mode,
          noiseSuppression: mode !== 'off',
        }),
      setAutoSensitivity: (autoSensitivity) => set({ autoSensitivity }),
      setNoiseGateThreshold: (noiseGateThreshold) => set({ noiseGateThreshold }),
      toggleNoiseSuppression: () =>
        set((s) => {
          const nextActive = s.noiseSuppressionMode === 'off' || !s.noiseSuppression;
          return {
            noiseSuppression: nextActive,
            noiseSuppressionMode: nextActive ? 'rnnoise' : 'off',
          };
        }),
      setMicMuted: (micMuted) => set({ micMuted }),
      setServerMuted: (serverMuted) => set({ serverMuted, micMuted: serverMuted ? true : false }),
      setCallMuted: (callMuted) => set({ callMuted }),
      toggleMicMute: () => set((s) => ({ micMuted: !s.micMuted })),
      toggleCallMute: () => set((s) => ({ callMuted: !s.callMuted })),
      toggleLocalMuteUser: (userId: string) => set((s) => {
        const isMuted = s.localMutedUsers.includes(userId);
        return {
          localMutedUsers: isMuted
            ? s.localMutedUsers.filter((id) => id !== userId)
            : [...s.localMutedUsers, userId],
        };
      }),
      setUserVolume: (userId, vol) =>
        set((state) => ({
          userVolumes: { ...state.userVolumes, [userId]: vol },
        })),

      setScreenShareResolution: (screenShareResolution) => set({ screenShareResolution }),
      setScreenShareFps: (screenShareFps) => set({ screenShareFps }),
      setScreenShareContentHint: (screenShareContentHint) => set({ screenShareContentHint }),
      setKeybindMicMute: (keybindMicMute) => set({ keybindMicMute }),
      setKeybindDeafen: (keybindDeafen) => set({ keybindDeafen }),
      setKeybindsEnabled: (keybindsEnabled) => set({ keybindsEnabled }),

      resetAll: () => set(defaults),
    }),
    {
      name: STORAGE_KEY,
    }
  )
);
