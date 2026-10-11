/**
 * EchoFilter – removes voice-chat echo from screen-share loopback audio.
 *
 * When sharing with system audio (loopback), ALL system sounds are captured,
 * including the remote participants' voices playing through the speakers.
 * This filter subtracts the known remote voice streams (inverted and
 * delay-compensated) from the loopback signal so peers no longer hear
 * themselves.
 *
 * The cancellation reduces echo energy significantly (~10-20 dB) even though
 * perfect phase alignment isn't guaranteed due to variable DAC / driver latency.
 */

interface RemoteSource {
  peerId: string;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  delay: DelayNode;
  gain: GainNode;
}

export class EchoFilter {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private loopbackSource: MediaStreamAudioSourceNode | null = null;
  private remoteSources: Map<string, RemoteSource> = new Map();
  private processedTrack: MediaStreamTrack | null = null;

  /**
   * Build the filter graph and return a *processed* audio track that has the
   * remote voice streams subtracted from the loopback signal in real-time.
   *
   * @param loopbackTrack  – raw loopback audio track from getDisplayMedia
   * @param remoteStreams   – current remote voice MediaStreams (peerId → stream)
   * @param remoteGainValues – optional map of peerId → current gain value (0-1)
   * @returns processed MediaStreamTrack, or original if error
   */
  start(
    loopbackTrack: MediaStreamTrack,
    remoteStreams?: Map<string, MediaStream>,
    remoteGainValues?: Map<string, number>,
  ): MediaStreamTrack {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.ctx = new AudioContextClass({ sampleRate: 48_000 });
      } catch {
        this.ctx = new AudioContextClass();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.dest = this.ctx.createMediaStreamDestination();

      // ── 1. Loopback passthrough ────────────────────────────────────
      const loopbackOnly = new MediaStream([loopbackTrack]);
      this.loopbackSource = this.ctx.createMediaStreamSource(loopbackOnly);
      this.loopbackSource.connect(this.dest);

      this.processedTrack = this.dest.stream.getAudioTracks()[0] ?? loopbackTrack;

      if (remoteStreams && remoteStreams.size > 0) {
        this.updateRemoteStreams(remoteStreams, remoteGainValues);
      }

      return this.processedTrack;
    } catch (err) {
      console.warn('[EchoFilter] Initialisation failed, using raw loopback:', err);
      this.dispose();
      return loopbackTrack;
    }
  }

  /**
   * Dynamically add, update or remove remote voice streams as peers speak,
   * join or leave the voice channel during the screen share session.
   */
  updateRemoteStreams(
    remoteStreams: Map<string, MediaStream>,
    remoteGainValues?: Map<string, number>,
  ): void {
    if (!this.ctx || !this.dest || this.ctx.state === 'closed') return;

    const rawDelay = (this.ctx as any).outputLatency as number | undefined;
    const estimatedDelay = Math.max(rawDelay ?? 0.03, 0.015);

    // 1. Remove peers that are no longer in remoteStreams
    for (const [peerId, r] of this.remoteSources.entries()) {
      if (!remoteStreams.has(peerId)) {
        try { r.source.disconnect(); } catch {}
        try { r.delay.disconnect(); } catch {}
        try { r.gain.disconnect(); } catch {}
        this.remoteSources.delete(peerId);
      }
    }

    // 2. Add or update active peer audio tracks
    remoteStreams.forEach((stream, peerId) => {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState === 'ended') {
        const existing = this.remoteSources.get(peerId);
        if (existing) {
          try { existing.source.disconnect(); } catch {}
          try { existing.delay.disconnect(); } catch {}
          try { existing.gain.disconnect(); } catch {}
          this.remoteSources.delete(peerId);
        }
        return;
      }

      const userGain = remoteGainValues?.get(peerId) ?? 1;
      const targetGain = -0.85 * userGain;

      const existing = this.remoteSources.get(peerId);
      if (existing) {
        if (existing.stream === stream) {
          existing.gain.gain.value = targetGain;
          return;
        }
        try { existing.source.disconnect(); } catch {}
        try { existing.delay.disconnect(); } catch {}
        try { existing.gain.disconnect(); } catch {}
        this.remoteSources.delete(peerId);
      }

      try {
        const source = this.ctx!.createMediaStreamSource(new MediaStream([audioTrack]));
        const delay = this.ctx!.createDelay(1.0);
        delay.delayTime.value = estimatedDelay;

        const invertGain = this.ctx!.createGain();
        invertGain.gain.value = targetGain;

        source.connect(delay);
        delay.connect(invertGain);
        invertGain.connect(this.dest!);

        this.remoteSources.set(peerId, { peerId, stream, source, delay, gain: invertGain });
      } catch (sourceErr) {
        console.warn('[EchoFilter] Could not connect remote source:', sourceErr);
      }
    });
  }

  /** Tear down the entire filter graph and release resources. */
  dispose(): void {
    for (const r of this.remoteSources.values()) {
      try { r.source.disconnect(); } catch {}
      try { r.delay.disconnect(); } catch {}
      try { r.gain.disconnect(); } catch {}
    }
    this.remoteSources.clear();

    try { this.loopbackSource?.disconnect(); } catch {}
    this.loopbackSource = null;
    this.dest = null;

    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }

    this.processedTrack = null;
  }
}
