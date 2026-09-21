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
let lastBroadcastTime = 0;

// Cooldown em ms entre emissões de title-started para o mesmo título
const TITLE_STARTED_COOLDOWN_MS = 5000;

// Debounce de seek — evita spam de eventos de seek
let seekDebounceTimer: any = null;

// Retry de sync após apply-streaming-playback quando vídeo ainda não está pronto
let syncRetryCount = 0;
let syncRetryTimer: any = null;
const MAX_SYNC_RETRIES = 6;
const SYNC_RETRY_DELAY_MS = 2000;

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
  // Netflix — URL de reprodução real (não catálogo)
  if (url.includes('netflix.com/watch/')) return true;
  // Prime Video — URL de reprodução real
  if (url.includes('primevideo.com') && (url.includes('/watch/') || url.includes('/detail/') || url.includes('/gp/video/'))) {
    return true;
  }
  return false;
}

/**
 * Verifica se o vídeo está realmente reproduzindo:
 * - não pausado
 * - não em buffering (readyState >= 2)
 * - currentTime > 1s (afastado do início para evitar falso positivo de pré-roll)
 */
function isVideoActuallyPlaying(video: HTMLVideoElement): boolean {
  return !video.paused && video.readyState >= 2 && video.currentTime > 1;
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
        isPlaying: true,
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
        isPlaying: false,
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
          isPlaying: !video.paused,
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

    // ── title-started: emitir APENAS quando o vídeo está realmente reproduzindo
    // e a URL do título mudou, com cooldown para evitar spam
    const now = Date.now();
    const urlChanged = url !== lastBroadcastUrl;
    const cooldownExpired = (now - lastBroadcastTime) > TITLE_STARTED_COOLDOWN_MS;

    if (
      isWatchPartyEligibleUrl(url) &&
      isVideoActuallyPlaying(video) &&
      (urlChanged || cooldownExpired) &&
      urlChanged // sempre exige mudança de URL para ser "novo título"
    ) {
      lastBroadcastUrl = url;
      lastBroadcastTime = now;
      ipcRenderer.send('streaming-playback-event', {
        type: 'title-started',
        url,
        positionSeconds: video.currentTime,
        isPlaying: true,
      });
    }
  }

  // Deep-link auto play helper: se estivermos na página de detalhe do Prime Video
  // e houver um botão de play disponível (sem vídeo ainda), clicar nele automaticamente
  // SOMENTE se esta view foi aberta pelo Watch Party (tem um flag de redirect pendente)
  if (url.includes('primevideo.com/detail/') && !video) {
    const playBtn = document.querySelector<HTMLElement>(
      '[data-automation-id="playback-button"], a[href*="/watch/"], button[aria-label*="Assistir agora"], button[aria-label*="Continuar assistindo"], button[aria-label*="Reproduzir"]'
    );
    if (playBtn && (window as any).__concord_auto_play) {
      (window as any).__concord_auto_play = false;
      setTimeout(() => playBtn.click(), 500);
    }
  }
}

// Observe e poll para mudanças de vídeo
setInterval(checkPlaybackState, 800);
window.addEventListener('DOMContentLoaded', checkPlaybackState);
window.addEventListener('popstate', () => {
  // URL mudou via SPA navigation — verificar logo após a transição
  setTimeout(checkPlaybackState, 300);
  setTimeout(checkPlaybackState, 1000);
});

// ── Receber comandos remotos do processo principal Concord ──
ipcRenderer.on('apply-streaming-playback', (_event, data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }) => {
  // Cancelar retries anteriores se houver novo comando
  if (syncRetryTimer) {
    clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
    syncRetryCount = 0;
  }

  applyPlaybackCommand(data);
});

function applyPlaybackCommand(data: { action: 'play' | 'pause' | 'seek'; positionSeconds?: number }, retryAttempt = 0) {
  isRemoteAction = true;
  if (remoteActionTimeout) clearTimeout(remoteActionTimeout);

  const video = document.querySelector<HTMLVideoElement>('video');

  if (!video) {
    // Vídeo ainda não carregou — retry se dentro do limite
    if (retryAttempt < MAX_SYNC_RETRIES) {
      syncRetryCount = retryAttempt + 1;
      syncRetryTimer = setTimeout(() => {
        applyPlaybackCommand(data, retryAttempt + 1);
      }, SYNC_RETRY_DELAY_MS);
    }
    // Liberar o flag imediatamente para não bloquear eventos locais enquanto espera
    remoteActionTimeout = setTimeout(() => {
      isRemoteAction = false;
    }, 500);
    return;
  }

  syncRetryCount = 0;

  if (data.action === 'seek' && typeof data.positionSeconds === 'number') {
    video.currentTime = data.positionSeconds;
  } else if (data.action === 'play') {
    // Sincronizar posição se houver desvio > 2.5s
    if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.5) {
      video.currentTime = data.positionSeconds;
    }
    if (video.paused) {
      video.play().catch(() => {});
      // Fallback via botão DOM (alguns players bloqueiam video.play())
      setTimeout(clickPlayButton, 100);
    }
  } else if (data.action === 'pause') {
    // Sincronizar posição se houver desvio > 2.5s
    if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.5) {
      video.currentTime = data.positionSeconds;
    }
    if (!video.paused) {
      video.pause();
      // Fallback via botão DOM
      setTimeout(clickPauseButton, 100);
    }
  }

  // Suprimir eventos locais por 800ms para evitar loops de echo
  remoteActionTimeout = setTimeout(() => {
    isRemoteAction = false;
  }, 800);
}

// ── Sinalizar ao Electron quando a view deve navegar automaticamente para um título
// (usado pelo Watch Party quando o receptor clica "Assistir Junto")
ipcRenderer.on('navigate-to-title', (_event, data: { url: string; autoPlay?: boolean }) => {
  if (data.autoPlay) {
    (window as any).__concord_auto_play = true;
  }
  if (window.location.href !== data.url) {
    window.location.href = data.url;
  }
});
