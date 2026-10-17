import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import { playJoinSound, playLeaveSound } from '../utils/soundEffects';
import { SERVER_URL } from '../config';

type EmitFn = (event: string, ...args: unknown[]) => void;

interface PeerConnection {
  pc: RTCPeerConnection;
  audioEl?: HTMLAudioElement;
  screenAudioEl?: HTMLAudioElement;
  micTrack?: MediaStreamTrack;
  makingOffer: boolean;
  ignoreOffer: boolean;
  screenSender?: RTCRtpSender;
  screenAudioSender?: RTCRtpSender;
  screenVideoTransceiver?: RTCRtpTransceiver;
  screenAudioTransceiver?: RTCRtpTransceiver;
  /** Set when a renegotiation was requested while the connection was not stable. */
  renegotiateQueued?: boolean;
  /** Queue-aware offer trigger (perfect-negotiation). */
  makeOffer?: () => Promise<void>;
}

type AttachRemoteFn = (audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => void;

/**
 * Helper to dynamically calibrate sender bitrate and encoding parameters
 * according to resolution, FPS, content hint and total peers on the call.
 */
function applySenderBitrate(sender: RTCRtpSender, isVideo: boolean, peerCount: number) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    const { screenShareResolution, screenShareFps, screenShareContentHint } = useAudioStore.getState();

    if (isVideo) {
      let baseBitrate = 5_000_000; // 1080p 60fps standard
      if (screenShareResolution === '1440p' && screenShareFps === 60) {
        baseBitrate = 7_500_000; // 7.5 Mbps
      } else if (screenShareResolution === '1440p' && screenShareFps === 30) {
        baseBitrate = 5_500_000;
      } else if (screenShareResolution === '1080p' && screenShareFps === 60) {
        baseBitrate = 5_000_000; // 5.0 Mbps
      } else if (
        (screenShareResolution === '1080p' && screenShareFps === 30) ||
        (screenShareResolution === '720p' && screenShareFps === 60)
      ) {
        baseBitrate = 3_500_000; // 3.5 Mbps
      } else if (screenShareResolution === '720p' && screenShareFps === 30) {
        baseBitrate = 2_500_000; // 2.5 Mbps
      }

      // If more than 4 peers, adjust proportionally to avoid saturating upstream, keeping >= 2 Mbps
      let adjustedBitrate = baseBitrate;
      if (peerCount > 4) {
        adjustedBitrate = Math.max(2_000_000, Math.round(baseBitrate * (4 / peerCount)));
      }

      params.encodings[0].maxBitrate = adjustedBitrate;
      params.encodings[0].maxFramerate = screenShareFps;
      // @ts-ignore
      params.degradationPreference =
        screenShareContentHint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
    } else {
      params.encodings[0].maxBitrate = 128_000; // 128 kbps high-clarity stereo/system audio for screen share
    }

    sender.setParameters(params).catch(() => {});
  } catch (err) {
    console.debug('[WebRTC] applySenderBitrate error:', err);
  }
}

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

  const attachScreenAudioTrack = useCallback(
    (peerId: string, peerData: PeerConnection, sAudio: MediaStreamTrack) => {
      let screenAudioEl = peerData.screenAudioEl;
      if (!screenAudioEl) {
        screenAudioEl = (document.getElementById(`remote-screen-audio-${peerId}`) as HTMLAudioElement) || null;
        if (!screenAudioEl) {
          screenAudioEl = document.createElement('audio');
          screenAudioEl.id = `remote-screen-audio-${peerId}`;
          screenAudioEl.autoplay = true;
          (screenAudioEl as any).playsInline = true;

          const container = document.getElementById('remote-audios') || document.body;
          container.appendChild(screenAudioEl);
        }
        peerData.screenAudioEl = screenAudioEl;
      }

      const existingStream = screenAudioEl.srcObject as MediaStream | null;
      const alreadyAttached =
        existingStream instanceof MediaStream &&
        existingStream.getAudioTracks().some((t) => t.id === sAudio.id);

      const audioOnlyStream = alreadyAttached && existingStream ? existingStream : new MediaStream([sAudio]);
      if (!alreadyAttached) {
        screenAudioEl.srcObject = audioOnlyStream;
      }

      const outputId = useAudioStore.getState().selectedAudioOutputId;
      if (outputId && outputId !== 'default' && typeof (screenAudioEl as any).setSinkId === 'function') {
        (screenAudioEl as any).setSinkId(outputId).catch(() => {});
      }

      if (attachRemoteScreenAudio) {
        attachRemoteScreenAudio(screenAudioEl, audioOnlyStream, peerId);
      } else {
        screenAudioEl.play().catch((err) => {
          console.warn('[WebRTC] Remote screen audio autoplay blocked:', err);
        });
      }

      sAudio.onunmute = () => {
        if (peerData.screenAudioEl) {
          if (attachRemoteScreenAudio) {
            attachRemoteScreenAudio(peerData.screenAudioEl, audioOnlyStream, peerId);
          } else if (peerData.screenAudioEl.paused) {
            peerData.screenAudioEl.play().catch(() => {});
          }
        }
      };
    },
    [attachRemoteScreenAudio]
  );

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
      const existing = peersRef.current.get(peerId);
      if (existing) {
        try {
          existing.pc.onicecandidate = null;
          existing.pc.ontrack = null;
          existing.pc.onsignalingstatechange = null;
          existing.pc.onnegotiationneeded = null;
          existing.pc.oniceconnectionstatechange = null;
          existing.pc.close();
        } catch {}
        if (existing.audioEl) {
          existing.audioEl.pause();
          existing.audioEl.srcObject = null;
          existing.audioEl.remove();
        }
        if (existing.screenAudioEl) {
          existing.screenAudioEl.pause();
          existing.screenAudioEl.srcObject = null;
          existing.screenAudioEl.remove();
        }
        peersRef.current.delete(peerId);
        pendingIceRef.current.delete(peerId);
      }

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const peerData: PeerConnection = { pc, makingOffer: false, ignoreOffer: false };
      peersRef.current.set(peerId, peerData);

      // Add local audio tracks
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      // Add screen share tracks if active using dedicated transceivers
      if (screenStreamRef.current) {
        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        const audioTrack = screenStreamRef.current.getAudioTracks()[0];

        if (videoTrack) {
          try {
            peerData.screenVideoTransceiver = pc.addTransceiver(videoTrack, {
              direction: 'sendonly',
              streams: [screenStreamRef.current],
            });
            peerData.screenSender = peerData.screenVideoTransceiver.sender;
            applySenderBitrate(peerData.screenSender, true, peersRef.current.size);
          } catch (err) {
            console.warn('[WebRTC] Error adding initial screen video transceiver:', err);
          }
        }

        if (audioTrack) {
          try {
            peerData.screenAudioTransceiver = pc.addTransceiver(audioTrack, {
              direction: 'sendonly',
              streams: [screenStreamRef.current],
            });
            peerData.screenAudioSender = peerData.screenAudioTransceiver.sender;
            applySenderBitrate(peerData.screenAudioSender, false, peersRef.current.size);
          } catch (err) {
            console.warn('[WebRTC] Error adding initial screen audio transceiver:', err);
          }
        }
      }

      // ICE candidates
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          emit('send_ice', peerId, candidate.toJSON());
        }
      };

      // Queue-aware (re)negotiation. If the connection isn't stable yet
      // (e.g. a screen track was added mid-handshake), remember that an offer
      // is owed and fire it once we return to `stable`.
      const negotiate = async () => {
        try {
          if (peerData.makingOffer || pc.signalingState !== 'stable') {
            peerData.renegotiateQueued = true;
            return;
          }
          peerData.makingOffer = true;
          await pc.setLocalDescription();
          emit('send_offer', peerId, pc.localDescription!);
        } catch (err) {
          console.error('[WebRTC] negotiate error', err);
        } finally {
          peerData.makingOffer = false;
        }
      };
      peerData.makeOffer = negotiate;

      pc.onnegotiationneeded = negotiate;

      pc.onsignalingstatechange = () => {
        if (pc.signalingState === 'stable' && peerData.renegotiateQueued) {
          peerData.renegotiateQueued = false;
          negotiate();
        }
      };

      // Remote tracks
      pc.ontrack = ({ track, streams, transceiver }) => {
        if (track.kind === 'video') {
          // This is a screen share stream: ALWAYS isolate to a pure video-only MediaStream
          const videoOnlyStream = new MediaStream([track]);
          remoteScreenStreamsRef.current.set(peerId, videoOnlyStream);
          setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));

          track.onended = () => {
            remoteScreenStreamsRef.current.delete(peerId);
            setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
            if (peerData.screenAudioEl) {
              peerData.screenAudioEl.pause();
              peerData.screenAudioEl.srcObject = null;
            }
            if (useAppStore.getState().screenShareUserId === peerId) {
              useAppStore.getState().setScreenShare(null, null);
            }
          };

          track.onunmute = () => {
            if (!remoteScreenStreamsRef.current.has(peerId)) {
              remoteScreenStreamsRef.current.set(peerId, new MediaStream([track]));
            }
            setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
          };
        } else if (track.kind === 'audio') {
          // Diferencie microfone vs áudio da tela de forma infalível:
          // 1. Se streams[0] tem trilha de vídeo, é áudio da tela.
          // 2. Se já temos peerData.micTrack com ID diferente, é a segunda trilha de áudio (áudio da tela).
          // 3. Se este transceiver de áudio não é o primeiro transceiver de áudio da conexão (mid > primeiro mid de áudio), é áudio da tela.
          const hasVideoInStream = (streams[0]?.getVideoTracks().length ?? 0) > 0;
          const isSecondAudio = Boolean(peerData.micTrack && peerData.micTrack.id !== track.id);
          const audioTransceivers = pc.getTransceivers().filter(
            (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
          );
          const isAdditionalAudioTransceiver =
            audioTransceivers.length > 1 && transceiver && audioTransceivers[0] !== transceiver;
          const isScreenAudio = hasVideoInStream || isSecondAudio || Boolean(isAdditionalAudioTransceiver);

          if (isScreenAudio) {
            attachScreenAudioTrack(peerId, peerData, track);
          } else {
            peerData.micTrack = track;
            let audioEl = peerData.audioEl;
            if (!audioEl) {
              audioEl = (document.getElementById(`remote-audio-${peerId}`) as HTMLAudioElement) || null;
              if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `remote-audio-${peerId}`;
                audioEl.autoplay = true;
                (audioEl as any).playsInline = true;

                const container = document.getElementById('remote-audios') || document.body;
                container.appendChild(audioEl);
              }
              peerData.audioEl = audioEl;
            }

            const micStream = new MediaStream([track]);
            audioEl.srcObject = micStream;
            const outputId = useAudioStore.getState().selectedAudioOutputId;
            if (outputId && outputId !== 'default' && typeof (audioEl as any).setSinkId === 'function') {
              (audioEl as any).setSinkId(outputId).catch(() => {});
            }
            audioEl.play().catch((err) => {
              console.warn('[WebRTC] Remote mic audio autoplay blocked:', err);
            });

            if (attachRemoteStream) {
              attachRemoteStream(audioEl, micStream, peerId);
            }
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
    [emit, attachRemoteStream, attachScreenAudioTrack]
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
      const existing = peersRef.current.get(userId);
      if (
        existing &&
        (existing.pc.connectionState === 'connected' ||
          existing.pc.iceConnectionState === 'connected' ||
          existing.pc.iceConnectionState === 'completed')
      ) {
        return;
      }
      playJoinSound();
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
    try {
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.onsignalingstatechange = null;
      peer.pc.onnegotiationneeded = null;
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.close();
    } catch {}
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
      const myId = useAppStore.getState().myId || myIdRef.current;
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
          peerData.renegotiateQueued = true;
        } else {
          await pc.setRemoteDescription(offer);
        }
        await pc.setLocalDescription();
        emit('send_answer', senderId, pc.localDescription!);
        await flushPendingIce(senderId);

        if (peerData.renegotiateQueued && pc.signalingState === 'stable') {
          peerData.renegotiateQueued = false;
          peerData.makeOffer?.();
        }
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
      try {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onsignalingstatechange = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.close();
      } catch {}
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

    peersRef.current.forEach(async (peer) => {
      try {
        if (videoTrack) {
          if (peer.screenVideoTransceiver) {
            await peer.screenVideoTransceiver.sender.replaceTrack(videoTrack);
            if (typeof peer.screenVideoTransceiver.sender.setStreams === 'function') {
              peer.screenVideoTransceiver.sender.setStreams(stream);
            }
            peer.screenVideoTransceiver.direction = 'sendonly';
          } else {
            peer.screenVideoTransceiver = peer.pc.addTransceiver(videoTrack, {
              direction: 'sendonly',
              streams: [stream],
            });
            peer.screenSender = peer.screenVideoTransceiver.sender;
          }
          if (peer.screenVideoTransceiver.sender) {
            applySenderBitrate(peer.screenVideoTransceiver.sender, true, peersRef.current.size);
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Error adding screen video transceiver:', err);
      }

      try {
        if (audioTrack) {
          if (peer.screenAudioTransceiver) {
            await peer.screenAudioTransceiver.sender.replaceTrack(audioTrack);
            if (typeof peer.screenAudioTransceiver.sender.setStreams === 'function') {
              peer.screenAudioTransceiver.sender.setStreams(stream);
            }
            peer.screenAudioTransceiver.direction = 'sendonly';
          } else {
            peer.screenAudioTransceiver = peer.pc.addTransceiver(audioTrack, {
              direction: 'sendonly',
              streams: [stream],
            });
            peer.screenAudioSender = peer.screenAudioTransceiver.sender;
          }
          if (peer.screenAudioTransceiver.sender) {
            applySenderBitrate(peer.screenAudioTransceiver.sender, false, peersRef.current.size);
          }
        } else if (peer.screenAudioTransceiver) {
          await peer.screenAudioTransceiver.sender.replaceTrack(null);
          peer.screenAudioTransceiver.direction = 'inactive';
        }
      } catch (err) {
        console.warn('[WebRTC] Error adding screen audio transceiver:', err);
      }

      // SEMPRE dispara makeOffer para TODOS os peers para garantir troca SDP e disparo de ontrack
      await peer.makeOffer?.();
    });

    if (audioTrack) {
      setTimeout(() => {
        peersRef.current.forEach((peer) => {
          if (peer.renegotiateQueued && peer.pc.signalingState === 'stable') {
            peer.renegotiateQueued = false;
            peer.makeOffer?.();
          }
        });
      }, 1500);
    }
  }, []);

  const removeScreenShareTrack = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    peersRef.current.forEach(async (peer) => {
      try {
        if (peer.screenVideoTransceiver) {
          await peer.screenVideoTransceiver.sender.replaceTrack(null);
          peer.screenVideoTransceiver.direction = 'inactive';
        } else if (peer.screenSender) {
          await peer.screenSender.replaceTrack(null);
        }

        if (peer.screenAudioTransceiver) {
          await peer.screenAudioTransceiver.sender.replaceTrack(null);
          peer.screenAudioTransceiver.direction = 'inactive';
        } else if (peer.screenAudioSender) {
          await peer.screenAudioSender.replaceTrack(null);
        }

        await peer.makeOffer?.();
      } catch (err) {
        console.warn('[WebRTC] Error removing screen track:', err);
      }
    });
  }, []);

  // Viewer-side teardown when a broadcaster stops sharing. Driven explicitly by user_stopped_screen_share.
  const clearRemoteScreen = useCallback((userId: string) => {
    remoteScreenStreamsRef.current.delete(userId);
    setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));

    const peer = peersRef.current.get(userId);
    if (peer?.screenAudioEl) {
      try {
        peer.screenAudioEl.pause();
        peer.screenAudioEl.srcObject = null;
      } catch {
        // ignore
      }
    }

    if (useAppStore.getState().screenShareUserId === userId) {
      useAppStore.getState().setScreenShare(null, null);
    }
  }, []);

  /**
   * Recovers or ensures an active MediaStream for the remote broadcaster
   * by inspecting receivers if the stream was missed or unmounted, and also
   * guarantees any remote screen audio track is attached and playing.
   */
  const ensureRemoteScreenStream = useCallback((userId: string): MediaStream | null => {
    const peer = peersRef.current.get(userId);
    if (peer) {
      const receivers = peer.pc.getReceivers();
      const liveScreenAudioReceiver = receivers.find(
        (r) =>
          r.track &&
          r.track.kind === 'audio' &&
          r.track.readyState === 'live' &&
          r.track.id !== peer.micTrack?.id
      );
      if (liveScreenAudioReceiver?.track) {
        attachScreenAudioTrack(userId, peer, liveScreenAudioReceiver.track);
      }
    }

    const existing = remoteScreenStreamsRef.current.get(userId);
    const liveVideoTrack = existing?.getVideoTracks().find((t) => t.readyState === 'live');
    if (existing && liveVideoTrack) {
      return existing;
    }

    if (!peer) return null;

    const receivers = peer.pc.getReceivers();
    const liveVideoReceiver = receivers.find(
      (r) => r.track && r.track.kind === 'video' && r.track.readyState === 'live'
    );

    if (liveVideoReceiver?.track) {
      const recovered = new MediaStream([liveVideoReceiver.track]);
      remoteScreenStreamsRef.current.set(userId, recovered);
      setRemoteScreenStreams(new Map(remoteScreenStreamsRef.current));
      return recovered;
    }

    return null;
  }, [attachScreenAudioTrack]);

  // Collect remote voice MediaStreams so the echo filter can subtract them from loopback
  const getRemoteAudioStreams = useCallback((): Map<string, MediaStream> => {
    const streams = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, peerId) => {
      const srcObj = peer.audioEl?.srcObject;
      if (srcObj && srcObj instanceof MediaStream && srcObj.getAudioTracks().length > 0) {
        streams.set(peerId, srcObj);
      }
    });
    return streams;
  }, []);

  return {
    joinVoice,
    leaveVoice,
    addScreenShareTrack,
    removeScreenShareTrack,
    clearRemoteScreen,
    ensureRemoteScreenStream,
    remoteScreenStreams,
    getRemoteAudioStreams,
    onExistingVoiceUsers,
    onUserJoinedVoice,
    onUserLeftVoice,
    onReceiveOffer,
    onReceiveAnswer,
    onReceiveIce,
  };
}
