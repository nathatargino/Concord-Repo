import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'concord_audio_v1';

interface AudioState {
  ytVol: number;
  micVol: number;
  remoteVol: number;
  micMuted: boolean;
  callMuted: boolean;
  noiseSuppression: boolean;
  noiseGateThreshold: number; // dBFS, range -100 to 0
  localMutedUsers: string[];
  userVolumes: Record<string, number>;

  setYtVol: (v: number) => void;
  setMicVol: (v: number) => void;
  setRemoteVol: (v: number) => void;
  setMicMuted: (v: boolean) => void;
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
  micMuted: false,
  callMuted: false,
  noiseSuppression: true,
  noiseGateThreshold: -30, // Approx 70% sensitivity
  localMutedUsers: [],
  userVolumes: {},
};

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      ...defaults,
      setYtVol: (ytVol) => set({ ytVol: Math.min(100, Math.max(0, ytVol)) }),
      setMicVol: (micVol) => set({ micVol: Math.min(200, Math.max(0, micVol)) }),
      setRemoteVol: (remoteVol) => set({ remoteVol: Math.min(200, Math.max(0, remoteVol)) }),
      setMicMuted: (micMuted) => set({ micMuted }),
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
