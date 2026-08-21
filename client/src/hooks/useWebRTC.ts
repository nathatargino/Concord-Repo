import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

type EmitFn = (event: string, ...args: unknown[]) => void;

interface PeerConnection {
  pc: RTCPeerConnection;
  audioEl?: HTMLAudioElement;
  screenVideoEl?: HTMLVideoElement;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export function useWebRTC(emit: EmitFn) {
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);

  const myIdRef = useRef('');


  // Fetch ICE servers from server
  const fetchIceServers = useCallback(async () => {
    if (iceServersRef.current.length > 1) return; // already fetched
    try {
      const res = await fetch(`${SERVER_URL}/api/turn/credentials`);
      const data = await res.json();
      if (data.iceServers?.length) {
        iceServersRef.current = data.iceServers;
      }
    } catch {
      // Use defaults
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string): PeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const peerData: PeerConnection = { pc, makingOffer: false, ignoreOffer: false };
      peersRef.current.set(peerId, peerData);

      // Add local audio tracks
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      // Add screen share track if active
      if (screenStreamRef.current) {
        for (const track of screenStreamRef.current.getTracks()) {
          pc.addTrack(track, screenStreamRef.current);
        }
      }

      // ICE candidates
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          emit('send_ice', peerId, candidate.toJSON());
        }
      };

      // Negotiation needed
      pc.onnegotiationneeded = async () => {
        try {
          peerData.makingOffer = true;
          await pc.setLocalDescription();
          emit('send_offer', peerId, pc.localDescription!);
        } catch (err) {
          console.error('[WebRTC] negotiationneeded error', err);
        } finally {
          peerData.makingOffer = false;
        }
      };

      // Remote tracks
      pc.ontrack = ({ track, streams }) => {
        if (track.kind === 'audio') {
          let audioEl = peerData.audioEl;
          if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `remote-audio-${peerId}`;
            audioEl.autoplay = true;

            document.getElementById('remote-audios')?.appendChild(audioEl);
            peerData.audioEl = audioEl;
          }
          audioEl.srcObject = streams[0] ?? null;
        }

        if (track.kind === 'video') {
          // This is a screen share stream
          const { setScreenShare } = useAppStore.getState();
          const users = useAppStore.getState().users;
          const user = users.find((u) => u.id === peerId);
          setScreenShare(peerId, user?.name ?? 'Usuário');

          let videoEl = peerData.screenVideoEl;
          if (!videoEl) {
            videoEl = document.getElementById('screen-share-video') as HTMLVideoElement | null ?? undefined;
            if (videoEl) peerData.screenVideoEl = videoEl;
          }
          if (videoEl) {
            videoEl.srcObject = streams[0] ?? null;
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
      };

      return peerData;
    },
    [emit]
  );

  const flushPendingIce = useCallback(async (peerId: string) => {
    const candidates = pendingIceRef.current.get(peerId);
    if (!candidates) return;
    const peer = peersRef.current.get(peerId);
    if (!peer) return;

    for (const c of candidates) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // ignore
      }
    }
    pendingIceRef.current.delete(peerId);
  }, []);

  // ─── CALLBACKS for socket ────────────────────────────────────────

  const onExistingVoiceUsers = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => createPeerConnection(id));
    },
    [createPeerConnection]
  );

  const onUserJoinedVoice = useCallback(
    async (userId: string) => {
      const peerData = createPeerConnection(userId);
      try {
        peerData.makingOffer = true;
        await peerData.pc.setLocalDescription();
        emit('send_offer', userId, peerData.pc.localDescription!);
      } catch (err) {
        console.error('[WebRTC] offer error', err);
      } finally {
        peerData.makingOffer = false;
      }
    },
    [createPeerConnection, emit]
  );

  const onUserLeftVoice = useCallback((userId: string) => {
    const peer = peersRef.current.get(userId);
    if (!peer) return;
    peer.pc.close();
    peer.audioEl?.remove();
    peer.screenVideoEl?.remove();
    peersRef.current.delete(userId);
    pendingIceRef.current.delete(userId);
  }, []);

  const onReceiveOffer = useCallback(
    async (senderId: string, offer: RTCSessionDescriptionInit) => {
      let peerData = peersRef.current.get(senderId);
      if (!peerData) {
        peerData = createPeerConnection(senderId);
      }

      const { pc } = peerData;
      const myId = myIdRef.current;
      const offerCollision =
        peerData.makingOffer || pc.signalingState !== 'stable';
      const polite = myId < senderId; // lexicographic tiebreak
      peerData.ignoreOffer = !polite && offerCollision;

      if (peerData.ignoreOffer) return;

      try {
        await pc.setRemoteDescription(offer);
        await pc.setLocalDescription();
        emit('send_answer', senderId, pc.localDescription!);
        await flushPendingIce(senderId);
      } catch (err) {
        console.error('[WebRTC] receive_offer error', err);
      }
    },
    [createPeerConnection, emit, flushPendingIce]
  );

  const onReceiveAnswer = useCallback(
    async (senderId: string, answer: RTCSessionDescriptionInit) => {
      const peer = peersRef.current.get(senderId);
      if (!peer) return;
      try {
        await peer.pc.setRemoteDescription(answer);
        await flushPendingIce(senderId);
      } catch (err) {
        console.error('[WebRTC] receive_answer error', err);
      }
    },
    [flushPendingIce]
  );

  const onReceiveIce = useCallback(
    async (senderId: string, candidate: RTCIceCandidateInit) => {
      const peer = peersRef.current.get(senderId);
      if (!peer || !peer.pc.remoteDescription) {
        // Buffer it
        const buf = pendingIceRef.current.get(senderId) ?? [];
        buf.push(candidate);
        pendingIceRef.current.set(senderId, buf);
        return;
      }
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore
      }
    },
    []
  );

  // ─── JOIN / LEAVE ────────────────────────────────────────────────

  const joinVoice = useCallback(
    async (myId: string, localStream: MediaStream) => {
      myIdRef.current = myId;
      localStreamRef.current = localStream;
      await fetchIceServers();
      emit('join_voice');
    },
    [emit, fetchIceServers]
  );

  const leaveVoice = useCallback(() => {
    peersRef.current.forEach((peer) => {
      peer.pc.close();
      peer.audioEl?.remove();
    });
    peersRef.current.clear();
    pendingIceRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    emit('leave_voice');
  }, [emit]);

  // ─── SCREEN SHARE ────────────────────────────────────────────────

  const addScreenShareTrack = useCallback((stream: MediaStream) => {
    screenStreamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    peersRef.current.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    });
  }, []);

  const removeScreenShareTrack = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    peersRef.current.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(null);
      }
    });
  }, []);

  return {
    joinVoice,
    leaveVoice,
    addScreenShareTrack,
    removeScreenShareTrack,
    onExistingVoiceUsers,
    onUserJoinedVoice,
    onUserLeftVoice,
    onReceiveOffer,
    onReceiveAnswer,
    onReceiveIce,
  };
}
