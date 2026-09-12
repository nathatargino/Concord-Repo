import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'concord_audio_v1';

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
  noiseGateThreshold: number; // dBFS, range -100 to 0
  localMutedUsers: string[];
  userVolumes: Record<string, number>;

  setYtVol: (v: number) => void;
  setMicVol: (v: number) => void;
  setRemoteVol: (v: number) => void;
  setScreenShareVol: (v: number) => void;
  setSelectedAudioInputId: (id: string) => void;
  setSelectedAudioOutputId: (id: string) => void;
  setNoiseSuppression: (v: boolean) => void;
  setNoiseGateThreshold: (v: number) => void;
  setMicMuted: (v: boolean) => void;
  setServerMuted: (v: boolean) => void;
  toggleMicMute: () => void;
  toggleCallMute: () => void;
  toggleLocalMuteUser: (userId: string) => void;
  setUserVolume: (userId: string, vol: number) => void;
  resetAll: () => void;
}

const defaults = {
  ytVol: 80,
  micVol: 100,
  remoteVol: 100,
  screenShareVol: 100,
  selectedAudioInputId: 'default',
  selectedAudioOutputId: 'default',
  micMuted: false,
  serverMuted: false,
  callMuted: false,
  noiseSuppression: true,
  noiseGateThreshold: -30, // Approx 70% sensitivity
  localMutedUsers: [],
  userVolumes: {},
};

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
      ...defaults,
      setYtVol: (ytVol) => set({ ytVol: Math.min(100, Math.max(0, ytVol)) }),
      setMicVol: (micVol) => set({ micVol: Math.min(200, Math.max(0, micVol)) }),
      setRemoteVol: (remoteVol) => set({ remoteVol: Math.min(200, Math.max(0, remoteVol)) }),
      setScreenShareVol: (screenShareVol) => set({ screenShareVol: Math.min(200, Math.max(0, screenShareVol)) }),
      setSelectedAudioInputId: (selectedAudioInputId) => set({ selectedAudioInputId }),
      setSelectedAudioOutputId: (selectedAudioOutputId) => {
        set({ selectedAudioOutputId });
        applyAudioOutputDevice(selectedAudioOutputId);
      },
      setNoiseSuppression: (noiseSuppression) => set({ noiseSuppression }),
      setNoiseGateThreshold: (noiseGateThreshold) => set({ noiseGateThreshold }),
      setMicMuted: (micMuted) => set({ micMuted }),
      setServerMuted: (serverMuted) => set({ serverMuted, micMuted: serverMuted ? true : false }),
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
      resetAll: () => set(defaults),
    }),
    {
      name: STORAGE_KEY,
    }
  )
);
