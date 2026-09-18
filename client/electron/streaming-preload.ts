import { ipcRenderer, webFrame } from 'electron';

// Immediately disable WebAuthn / Passkeys / USB FIDO security key prompts in streaming view (Netflix, Amazon Prime Video)
webFrame.executeJavaScript(`
  (function() {
    try {
      if (typeof window.PublicKeyCredential !== 'undefined') {
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function() {
          return Promise.resolve(false);
        };
        if (typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
          window.PublicKeyCredential.isConditionalMediationAvailable = function() {
            return Promise.resolve(false);
          };
        }
      }
      if (navigator.credentials) {
        var origGet = navigator.credentials.get ? navigator.credentials.get.bind(navigator.credentials) : null;
        navigator.credentials.get = function(options) {
          if (options && (options.publicKey || options.mediation === 'conditional')) {
            return Promise.reject(new DOMException("Passkeys are disabled in Concord streaming view", "NotSupportedError"));
          }
          return origGet ? origGet(options) : Promise.reject(new DOMException("Not supported", "NotSupportedError"));
        };
        var origCreate = navigator.credentials.create ? navigator.credentials.create.bind(navigator.credentials) : null;
        navigator.credentials.create = function(options) {
          if (options && options.publicKey) {
            return Promise.reject(new DOMException("Passkeys are disabled in Concord streaming view", "NotSupportedError"));
          }
          return origCreate ? origCreate(options) : Promise.reject(new DOMException("Not supported", "NotSupportedError"));
        };
      }
      if (navigator.usb) { try { Object.defineProperty(navigator, 'usb', { get: function() { return undefined; } }); } catch(e) {} }
      if (navigator.hid) { try { Object.defineProperty(navigator, 'hid', { get: function() { return undefined; } }); } catch(e) {} }

      // Ensure userAgentData reports modern Chrome for streaming sites like Prime Video
      if (navigator.userAgentData) {
        try {
          var chromeBrands = [
            { brand: 'Chromium', version: '150' },
            { brand: 'Google Chrome', version: '150' },
            { brand: 'Not/A)Brand', version: '24' }
          ];
          var fullVersionList = [
            { brand: 'Chromium', version: '150.0.7871.250' },
            { brand: 'Google Chrome', version: '150.0.7871.250' },
            { brand: 'Not/A)Brand', version: '24.0.0.0' }
          ];
          try {
            Object.defineProperty(navigator.userAgentData, 'brands', {
              get: function() { return chromeBrands; },
              configurable: true
            });
          } catch(e) {}

          var origFn = navigator.userAgentData.getHighEntropyValues;
          navigator.userAgentData.getHighEntropyValues = function(hints) {
            return (origFn ? origFn.call(navigator.userAgentData, hints) : Promise.resolve({})).then(function(res) {
              res = res || {};
              res.brands = chromeBrands;
              res.fullVersionList = fullVersionList;
              res.platform = 'Windows';
              res.platformVersion = res.platformVersion || '10.0.0';
              res.architecture = res.architecture || 'x86';
              res.bitness = res.bitness || '64';
              res.model = res.model || '';
              res.uaFullVersion = '150.0.7871.250';
              return res;
            }).catch(function() {
              return {
                architecture: 'x86',
                bitness: '64',
                brands: chromeBrands,
                fullVersionList: fullVersionList,
                mobile: false,
                model: '',
                platform: 'Windows',
                platformVersion: '10.0.0',
                uaFullVersion: '150.0.7871.250'
              };
            });
          };
        } catch(e) {}
      }
    } catch(e) {}
  })();
`);

// ═══════════════════════════════════════════════════════════════════
// ── CONCORD WATCH PARTY JS BRIDGE (NETFLIX & PRIME VIDEO SYNC) ──
// ═══════════════════════════════════════════════════════════════════

let isRemoteAction = false;
let remoteActionTimeout: any = null;
let lastBroadcastUrl = '';
let seekDebounceTimer: any = null;
let currentlyHookedVideo: HTMLVideoElement | null = null;

function clickPlayButton() {
  const playBtn = document.querySelector<HTMLElement>(
    '[data-uia="control-play-pause-play"], .button-nfplayerPlay, .atvwebplayersdk-playpause-button, [data-automation-id="playback-play-pause"], .pausedOverlayButton, button[aria-label*="Reproduzir"], button[aria-label*="Play"], button[aria-label*="Assistir"]'
  );
  if (playBtn) playBtn.click();
}

function clickPauseButton() {
  const pauseBtn = document.querySelector<HTMLElement>(
    '[data-uia="control-play-pause-pause"], .button-nfplayerPause, .atvwebplayersdk-playpause-button, [data-automation-id="playback-play-pause"], button[aria-label*="Pausar"], button[aria-label*="Pause"]'
  );
  if (pauseBtn) pauseBtn.click();
}

function isWatchPartyEligibleUrl(url: string): boolean {
  if (!url) return false;
  // Netflix watch URL
  if (url.includes('netflix.com/watch/')) return true;
  // Prime Video watch or detail URL
  if (url.includes('primevideo.com') && (url.includes('/watch/') || url.includes('/detail/') || url.includes('/gp/video/'))) {
    return true;
  }
  return false;
}

function hookVideoElement(video: HTMLVideoElement) {
  if (currentlyHookedVideo === video) return;
  currentlyHookedVideo = video;

  video.addEventListener('play', () => {
    if (isRemoteAction) return;
    const url = window.location.href;
    if (isWatchPartyEligibleUrl(url)) {
      ipcRenderer.send('streaming-playback-event', {
        type: 'play',
        positionSeconds: video.currentTime,
        url,
      });
    }
  });

  video.addEventListener('pause', () => {
    if (isRemoteAction) return;
    const url = window.location.href;
    if (isWatchPartyEligibleUrl(url)) {
      ipcRenderer.send('streaming-playback-event', {
        type: 'pause',
        positionSeconds: video.currentTime,
        url,
      });
    }
  });

  video.addEventListener('seeked', () => {
    if (isRemoteAction) return;
    if (seekDebounceTimer) clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      if (isRemoteAction || !video) return;
      const url = window.location.href;
      if (isWatchPartyEligibleUrl(url)) {
        ipcRenderer.send('streaming-playback-event', {
          type: 'seek',
          positionSeconds: video.currentTime,
          url,
        });
      }
    }, 350);
  });
}

function checkPlaybackState() {
  const url = window.location.href;
  const video = document.querySelector('video');

  if (video) {
    hookVideoElement(video);

    // Detect when video starts or URL transitions to a new title
    if (isWatchPartyEligibleUrl(url) && url !== lastBroadcastUrl && (!video.paused || video.currentTime > 0)) {
      lastBroadcastUrl = url;
      ipcRenderer.send('streaming-playback-event', {
        type: 'title-started',
        url,
        positionSeconds: video.currentTime,
        isPlaying: !video.paused,
      });
    }
  }

  // Deep-link auto play helper: if we are on a Prime Video detail page with a direct playback button
  if (url.includes('primevideo.com/detail/') && !video) {
    const playBtn = document.querySelector<HTMLElement>(
      '[data-automation-id="playback-button"], a[href*="/watch/"], button[aria-label*="Assistir agora"], button[aria-label*="Continuar assistindo"], button[aria-label*="Reproduzir"]'
    );
    if (playBtn) {
      playBtn.click();
    }
  }
}

// Observe and poll for video changes
setInterval(checkPlaybackState, 600);
window.addEventListener('DOMContentLoaded', checkPlaybackState);
window.addEventListener('popstate', checkPlaybackState);

// ── Receive remote commands from Discord / Concord main process ──
ipcRenderer.on('apply-streaming-playback', (_event, data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }) => {
  isRemoteAction = true;
  if (remoteActionTimeout) clearTimeout(remoteActionTimeout);

  const video = document.querySelector('video');
  if (video) {
    if (data.action === 'seek' && typeof data.positionSeconds === 'number') {
      video.currentTime = data.positionSeconds;
    } else if (data.action === 'play') {
      if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.5) {
        video.currentTime = data.positionSeconds;
      }
      if (video.paused) {
        video.play().catch(() => {});
        clickPlayButton();
      }
    } else if (data.action === 'pause') {
      if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.5) {
        video.currentTime = data.positionSeconds;
      }
      if (!video.paused) {
        video.pause();
        clickPauseButton();
      }
    }
  }

  // Suppress local events for 650ms to prevent infinite bounce / echo loops
  remoteActionTimeout = setTimeout(() => {
    isRemoteAction = false;
  }, 650);
});
