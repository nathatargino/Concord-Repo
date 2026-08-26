import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { playJoinSound, playLeaveSound } from '../utils/soundEffects';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

type EmitFn = (event: string, ...args: unknown[]) => void;

interface PeerConnection {
  pc: RTCPeerConnection;
  audioEl?: HTMLAudioElement;
  screenAudioEl?: HTMLAudioElement;
  makingOffer: boolean;
  ignoreOffer: boolean;
  screenSender?: RTCRtpSender;
  screenAudioSender?: RTCRtpSender;
}

type AttachRemoteFn = (audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => void;

export function useWebRTC(emit: EmitFn, attachRemoteStream?: AttachRemoteFn, attachRemoteScreenAudio?: AttachRemoteFn) {
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const inVoiceRef = useRef(false);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const remoteScreenStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);

  const myIdRef = useRef('');


  // Fetch ICE servers from server
  const fetchIceServers = useCallback(async () => {
    if (iceServersRef.current.length > 2) return; // already fetched TURN servers
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

      // Add screen share tracks if active
      if (screenStreamRef.current) {
        for (const track of screenStreamRef.current.getTracks()) {
          const sender = pc.addTrack(track, screenStreamRef.current);
          if (track.kind === 'video') {
            peerData.screenSender = sender;
          } else if (track.kind === 'audio') {
            peerData.screenAudioSender = sender;
          }
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
          if (pc.signalingState !== 'stable') {
            return;
          }
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
          const isScreenAudio = (streams[0]?.getVideoTracks().length ?? 0) > 0;
          if (isScreenAudio) {
            let screenAudioEl = peerData.screenAudioEl;
            if (!screenAudioEl) {
              screenAudioEl = document.createElement('audio');
              screenAudioEl.id = `remote-screen-audio-${peerId}`;
              screenAudioEl.autoplay = true;

              document.getElementById('remote-audios')?.appendChild(screenAudioEl);
              peerData.screenAudioEl = screenAudioEl;
            }
            if (attachRemoteScreenAudio) {
              attachRemoteScreenAudio(screenAudioEl, streams[0] ?? new MediaStream([track]), peerId);
            } else {
              screenAudioEl.srcObject = streams[0] ?? new MediaStream([track]);
            }
          } else {
            let audioEl = peerData.audioEl;
            if (!audioEl) {
              audioEl = document.createElement('audio');
              audioEl.id = `remote-audio-${peerId}`;
              audioEl.autoplay = true;

              document.getElementById('remote-audios')?.appendChild(audioEl);
              peerData.audioEl = audioEl;
            }
            // Always route through GainNode so the volume slider works.
            if (attachRemoteStream) {
              attachRemoteStream(audioEl, streams[0] ?? new MediaStream([track]), peerId);
            } else {
              audioEl.srcObject = streams[0] ?? null;
            }
          }
        }

        if (track.kind === 'video') {
          // This is a screen share stream
          const stream = streams[0] || new MediaStream([track]);
          remoteScreenStreamsRef.current.set(peerId, stream);
          setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));

          // If stream also contains screen audio track, connect it to screen audio
          const screenAudioTrack = stream.getAudioTracks()[0];
          if (screenAudioTrack) {
            let screenAudioEl = peerData.screenAudioEl;
            if (!screenAudioEl) {
              screenAudioEl = document.createElement('audio');
              screenAudioEl.id = `remote-screen-audio-${peerId}`;
              screenAudioEl.autoplay = true;

              document.getElementById('remote-audios')?.appendChild(screenAudioEl);
              peerData.screenAudioEl = screenAudioEl;
            }
            if (attachRemoteScreenAudio) {
              attachRemoteScreenAudio(screenAudioEl, stream, peerId);
            } else {
              screenAudioEl.srcObject = stream;
            }
          }

          const { setScreenShare } = useAppStore.getState();
          const users = useAppStore.getState().users;
          const user = users.find((u) => u.id === peerId);
          setScreenShare(peerId, user?.name ?? 'Usuário');

          track.onended = () => {
            remoteScreenStreamsRef.current.delete(peerId);
            setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
          };

          track.onunmute = () => {
            setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
          };
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
      };

      return peerData;
    },
    [emit, attachRemoteStream, attachRemoteScreenAudio]
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
      if (!inVoiceRef.current) return;
      ids.forEach((id) => createPeerConnection(id));
    },
    [createPeerConnection]
  );

  const onUserJoinedVoice = useCallback(
    async (userId: string) => {
      if (!inVoiceRef.current) return;
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
    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
      peer.audioEl.remove();
    }
    if (peer.screenAudioEl) {
      peer.screenAudioEl.pause();
      peer.screenAudioEl.srcObject = null;
      peer.screenAudioEl.remove();
    }
    peersRef.current.delete(userId);
    pendingIceRef.current.delete(userId);
    remoteScreenStreamsRef.current.delete(userId);
    setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
  }, []);

  const onReceiveOffer = useCallback(
    async (senderId: string, offer: RTCSessionDescriptionInit) => {
      if (!inVoiceRef.current) return;
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
        if (offerCollision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(offer),
          ]);
        } else {
          await pc.setRemoteDescription(offer);
        }
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
      if (!inVoiceRef.current) return;
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
      if (!inVoiceRef.current) return;
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
      inVoiceRef.current = true;
      myIdRef.current = myId;
      localStreamRef.current = localStream;
      await fetchIceServers();
      emit('join_voice');
      playJoinSound();
    },
    [emit, fetchIceServers]
  );

  const leaveVoice = useCallback(() => {
    inVoiceRef.current = false;
    peersRef.current.forEach((peer) => {
      peer.pc.close();
      if (peer.audioEl) {
        peer.audioEl.pause();
        peer.audioEl.srcObject = null;
        peer.audioEl.remove();
      }
      if (peer.screenAudioEl) {
        peer.screenAudioEl.pause();
        peer.screenAudioEl.srcObject = null;
        peer.screenAudioEl.remove();
      }
    });
    peersRef.current.clear();
    pendingIceRef.current.clear();
    remoteScreenStreamsRef.current.clear();
    setRemoteScreenStreams(new Map());
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    emit('leave_voice');
    playLeaveSound();
  }, [emit]);

  // ─── SCREEN SHARE ────────────────────────────────────────────────

  const addScreenShareTrack = useCallback((stream: MediaStream) => {
    screenStreamRef.current = stream;
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    peersRef.current.forEach((peer) => {
      try {
        if (videoTrack) {
          if (peer.screenSender) {
            peer.screenSender.replaceTrack(videoTrack).catch(() => {});
          } else {
            peer.screenSender = peer.pc.addTrack(videoTrack, stream);
          }
        }

        if (audioTrack) {
          if (peer.screenAudioSender) {
            peer.screenAudioSender.replaceTrack(audioTrack).catch(() => {});
          } else {
            peer.screenAudioSender = peer.pc.addTrack(audioTrack, stream);
          }
        } else if (peer.screenAudioSender) {
          peer.screenAudioSender.replaceTrack(null).catch(() => {});
        }
      } catch (err) {
        console.warn('[WebRTC] Error adding screen share track:', err);
      }
    });
  }, []);

  const removeScreenShareTrack = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    peersRef.current.forEach((peer) => {
      try {
        if (peer.screenSender) {
          peer.screenSender.replaceTrack(null).catch(() => {});
        }
        if (peer.screenAudioSender) {
          peer.screenAudioSender.replaceTrack(null).catch(() => {});
        }
      } catch (err) {
        console.warn('[WebRTC] Error removing screen track:', err);
      }
    });
  }, []);

  return {
    joinVoice,
    leaveVoice,
    addScreenShareTrack,
    removeScreenShareTrack,
    remoteScreenStreams,
    onExistingVoiceUsers,
    onUserJoinedVoice,
    onUserLeftVoice,
    onReceiveOffer,
    onReceiveAnswer,
    onReceiveIce,
  };
}
