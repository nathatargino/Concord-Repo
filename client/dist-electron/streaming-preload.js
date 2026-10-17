"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Immediately disable WebAuthn / Passkeys / USB FIDO security key prompts in streaming view (Netflix, Amazon Prime Video)
electron_1.webFrame.executeJavaScript(`
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
// Main World controller for Cadmium / Netflix Player and Prime Video
// Injected into the page's main JavaScript context so window.netflix is accessible
electron_1.webFrame.executeJavaScript(`
  (function() {
    window.__concord_get_netflix_player = function() {
      try {
        var vp = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
        if (!vp) return null;
        var sessionIds = vp.getAllPlayerSessionIds?.() || [];
        var sessionId = sessionIds.find(function(id) { return id && id.includes('watch'); }) || sessionIds[0];
        return sessionId ? vp.getVideoPlayerBySessionId(sessionId) : null;
      } catch(e) {
        return null;
      }
    };

    window.__concord_get_active_video = function() {
      var videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;
      if (videos.length === 1) return videos[0];

      var bestVideo = null;
      var bestScore = -1;

      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        var rect = v.getBoundingClientRect();
        var isVisible = rect.width > 200 && rect.height > 100;
        var area = rect.width * rect.height;
        var duration = (!isNaN(v.duration) && v.duration > 0) ? v.duration : 0;
        var readyState = v.readyState || 0;

        var score = 0;
        if (isVisible) score += 10000;
        if (readyState >= 1) score += 5000;
        if (readyState >= 2) score += 2000;
        if (!v.paused) score += 3000;
        if (duration > 45) score += 2000;
        score += Math.min(area / 100, 5000);
        score += Math.min(duration, 5000);

        if (score > bestScore) {
          bestScore = score;
          bestVideo = v;
        }
      }

      return bestVideo || videos[0];
    };

    window.__concord_main_playback = function(action, pos, delta) {
      try {
        var nfPlayer = window.__concord_get_netflix_player();
        var video = window.__concord_get_active_video();

        if (action === 'seek' && typeof pos === 'number') {
          if (nfPlayer && typeof nfPlayer.seek === 'function') {
            try { nfPlayer.seek(Math.round(pos * 1000)); } catch(e) {}
          }
          if (video) {
            try { video.currentTime = pos; } catch(e) {}
          }
        } else if (action === 'skip') {
          var step = typeof delta === 'number' ? delta : 10;
          var cur = (nfPlayer && typeof nfPlayer.getCurrentTime === 'function')
            ? (nfPlayer.getCurrentTime() / 1000)
            : (video ? video.currentTime : 0);
          var target = cur + step;
          if (nfPlayer && typeof nfPlayer.seek === 'function') {
            try { nfPlayer.seek(Math.round(target * 1000)); } catch(e) {}
          }
          if (video) {
            try { video.currentTime = Math.min((video.duration || Infinity), target); } catch(e) {}
          }
        } else if (action === 'play') {
          if (typeof pos === 'number' && video && Math.abs(video.currentTime - pos) > 2.0) {
            if (nfPlayer && typeof nfPlayer.seek === 'function') {
              try { nfPlayer.seek(Math.round(pos * 1000)); } catch(e) {}
            }
            try { video.currentTime = pos; } catch(e) {}
          }
          if (nfPlayer && typeof nfPlayer.play === 'function') {
            try { nfPlayer.play(); } catch(e) {}
          }
          if (video && video.paused) {
            try { video.play().catch(function() {}); } catch(e) {}
          }
        } else if (action === 'pause') {
          if (typeof pos === 'number' && video && Math.abs(video.currentTime - pos) > 2.0) {
            if (nfPlayer && typeof nfPlayer.seek === 'function') {
              try { nfPlayer.seek(Math.round(pos * 1000)); } catch(e) {}
            }
            try { video.currentTime = pos; } catch(e) {}
          }
          if (nfPlayer && typeof nfPlayer.pause === 'function') {
            try { nfPlayer.pause(); } catch(e) {}
          }
          if (video && !video.paused) {
            try { video.pause(); } catch(e) {}
          }
        }
      } catch(err) {}
    };

    window.addEventListener('__concord_playback_cmd', function(e) {
      if (!e || !e.detail) return;
      window.__concord_main_playback(e.detail.action, e.detail.positionSeconds, e.detail.deltaSeconds);
    });
  })();
`);
let isRemoteAction = false;
let suppressLocalEventsUntil = 0;
let remoteActionTimeout = null;
let lastBroadcastUrl = '';
let lastBroadcastTime = 0;
let lastHeartbeatTime = 0;
// Cooldown em ms entre emissões de title-started para o mesmo título
const TITLE_STARTED_COOLDOWN_MS = 4000;
// Debounce de seek — evita spam de eventos de seek
let seekDebounceTimer = null;
// Retry de sync após apply-streaming-playback quando vídeo ainda não está pronto
let syncRetryCount = 0;
let syncRetryTimer = null;
const MAX_SYNC_RETRIES = 12;
const SYNC_RETRY_DELAY_MS = 1000;
// Alvo de sincronização pendente (para quando há bumper/anúncio de classificação rodando)
let pendingSyncTarget = null;
let currentlyHookedVideo = null;
/**
 * Função para verificar se eventos locais de reprodução devem ser suprimidos
 * (evita echo loops e ping-pong entre participantes)
 */
function isEventSuppressed() {
    return isRemoteAction || Date.now() < suppressLocalEventsUntil;
}
/**
 * PROBLEMA 2: Inspeciona Array.from(document.querySelectorAll('video')) e retorna
 * o elemento <video> principal (priorizando vídeos visíveis com rect.width > 200 && rect.height > 100,
 * readyState >= 1 e maior duration/área).
 */
function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0)
        return null;
    if (videos.length === 1)
        return videos[0];
    let bestVideo = null;
    let bestScore = -1;
    for (const v of videos) {
        const rect = v.getBoundingClientRect();
        const isVisible = rect.width > 200 && rect.height > 100;
        const area = rect.width * rect.height;
        const duration = (!isNaN(v.duration) && v.duration > 0) ? v.duration : 0;
        const readyState = v.readyState || 0;
        let score = 0;
        if (isVisible)
            score += 10000;
        if (readyState >= 1)
            score += 5000;
        if (readyState >= 2)
            score += 2000;
        if (!v.paused)
            score += 3000;
        if (duration > 45)
            score += 2000;
        score += Math.min(area / 100, 5000);
        score += Math.min(duration, 5000);
        if (score > bestScore) {
            bestScore = score;
            bestVideo = v;
        }
    }
    return bestVideo || videos[0];
}
/**
 * PROBLEMA 3: Fallback de clique seguro para Play.
 * Só acionado se o vídeo realmente permanecer pausado.
 */
function clickPlayButton() {
    const video = getActiveVideo();
    if (video && !video.paused)
        return;
    const netflixPlayBtn = document.querySelector('[data-uia="control-play-pause-play"], .button-nfplayerPlay, .pausedOverlayButton');
    if (netflixPlayBtn) {
        netflixPlayBtn.click();
        return;
    }
    const crunchyPlayBtn = document.querySelector("[data-testid='vilos-play_pause_button']");
    if (crunchyPlayBtn) {
        crunchyPlayBtn.click();
        return;
    }
    const playBtn = document.querySelector('.atvwebplayersdk-playpause-button, [data-automation-id="playback-play-pause"], button[aria-label*="Reproduzir"], button[aria-label*="Play"], button[aria-label*="Assistir"]');
    if (playBtn)
        playBtn.click();
    const vilosVideo = document.querySelector('#vilosRoot video');
    if (vilosVideo && vilosVideo.paused) {
        vilosVideo.play().catch(() => { });
    }
}
/**
 * PROBLEMA 3: Fallback de clique seguro para Pause.
 * Só acionado se o vídeo realmente permanecer em reprodução.
 */
function clickPauseButton() {
    const video = getActiveVideo();
    if (video && video.paused)
        return;
    const netflixPauseBtn = document.querySelector('[data-uia="control-play-pause-pause"], .button-nfplayerPause');
    if (netflixPauseBtn) {
        netflixPauseBtn.click();
        return;
    }
    const crunchyPauseBtn = document.querySelector("[data-testid='vilos-play_pause_button']");
    if (crunchyPauseBtn) {
        crunchyPauseBtn.click();
        return;
    }
    const pauseBtn = document.querySelector('.atvwebplayersdk-playpause-button, [data-automation-id="playback-play-pause"], button[aria-label*="Pausar"], button[aria-label*="Pause"]');
    if (pauseBtn)
        pauseBtn.click();
    const vilosVideo = document.querySelector('#vilosRoot video');
    if (vilosVideo && !vilosVideo.paused) {
        vilosVideo.pause();
    }
}
let lastBroadcastVideo = null;
/**
 * Suporte a URLs da Netflix, Prime Video e Crunchyroll.
 */
function isWatchPartyEligibleUrl(url, video) {
    if (!url)
        return false;
    const lowerUrl = url.toLowerCase();
    // Netflix — URL de reprodução direta
    if (lowerUrl.includes('netflix.com/watch/'))
        return true;
    // Prime Video — rotas de reprodução e detalhe
    if ((lowerUrl.includes('primevideo.com') || lowerUrl.includes('amazon.')) && (lowerUrl.includes('/watch') ||
        lowerUrl.includes('/detail') ||
        lowerUrl.includes('/gp/video') ||
        lowerUrl.includes('/dp') ||
        lowerUrl.includes('/region'))) {
        return true;
    }
    // Crunchyroll — rotas de reprodução direta, player Vilos ou CDN estático
    if (lowerUrl.includes('crunchyroll.com') && (lowerUrl.includes('/watch/') ||
        lowerUrl.includes('vilos/player.html') ||
        lowerUrl.includes('static.crunchyroll.com'))) {
        return true;
    }
    // Fallback: qualquer URL Netflix, Prime Video ou Crunchyroll se houver elemento <video> principal visível e carregado
    const activeVideo = video || getActiveVideo();
    if (activeVideo && (lowerUrl.includes('netflix.com') || lowerUrl.includes('primevideo.com') || lowerUrl.includes('amazon.') || lowerUrl.includes('crunchyroll.com'))) {
        const rect = activeVideo.getBoundingClientRect();
        const isMainPlayer = rect.width > 250 && rect.height > 140;
        if (isMainPlayer && activeVideo.readyState >= 1 && (!activeVideo.paused || activeVideo.currentTime > 0 || activeVideo.duration > 30)) {
            return true;
        }
    }
    return false;
}
/**
 * Verifica se o vídeo está reproduzindo ou pronto em página dedicada de episódio/filme
 */
function isVideoActuallyPlaying(video) {
    return !video.paused && video.readyState >= 1 && video.currentTime >= 0;
}
function hookVideoElement(video) {
    if (currentlyHookedVideo === video)
        return;
    currentlyHookedVideo = video;
    video.addEventListener('play', () => {
        if (isEventSuppressed())
            return;
        const url = window.location.href;
        if (isWatchPartyEligibleUrl(url, video)) {
            electron_1.ipcRenderer.send('streaming-playback-event', {
                type: 'play',
                positionSeconds: video.currentTime,
                isPlaying: true,
                url,
            });
        }
    });
    video.addEventListener('pause', () => {
        if (isEventSuppressed())
            return;
        const url = window.location.href;
        if (isWatchPartyEligibleUrl(url, video)) {
            electron_1.ipcRenderer.send('streaming-playback-event', {
                type: 'pause',
                positionSeconds: video.currentTime,
                isPlaying: false,
                url,
            });
        }
    });
    video.addEventListener('seeked', () => {
        if (isEventSuppressed())
            return;
        if (seekDebounceTimer)
            clearTimeout(seekDebounceTimer);
        seekDebounceTimer = setTimeout(() => {
            if (isEventSuppressed() || !video)
                return;
            const url = window.location.href;
            if (isWatchPartyEligibleUrl(url, video)) {
                electron_1.ipcRenderer.send('streaming-playback-event', {
                    type: 'seek',
                    positionSeconds: video.currentTime,
                    isPlaying: !video.paused,
                    url,
                });
            }
        }, 350);
    });
    // Quando o duration muda (ex: terminou bumper de aviso do Prime Video e começou o filme de 2 horas)
    video.addEventListener('durationchange', () => {
        if (pendingSyncTarget && !isNaN(video.duration) && video.duration > 45) {
            const target = pendingSyncTarget;
            pendingSyncTarget = null;
            applyPlaybackCommand(target, 0);
        }
    });
}
function checkPlaybackState() {
    const url = window.location.href;
    const video = getActiveVideo();
    if (video) {
        hookVideoElement(video);
        // Se temos um alvo de sincronização pendente esperando o filme carregar após bumper
        if (pendingSyncTarget && !isNaN(video.duration) && video.duration > 45) {
            const target = pendingSyncTarget;
            pendingSyncTarget = null;
            applyPlaybackCommand(target, 0);
        }
        // ── title-started: emitir quando o vídeo está aberto/reproduzindo e a URL é válida
        const now = Date.now();
        const urlChanged = url !== lastBroadcastUrl;
        const videoChanged = video !== lastBroadcastVideo;
        const cooldownExpired = (now - lastBroadcastTime) > TITLE_STARTED_COOLDOWN_MS;
        if (isWatchPartyEligibleUrl(url, video) &&
            (isVideoActuallyPlaying(video) || video.readyState >= 1) &&
            (urlChanged || videoChanged) &&
            (urlChanged || cooldownExpired)) {
            lastBroadcastUrl = url;
            lastBroadcastVideo = video;
            lastBroadcastTime = now;
            electron_1.ipcRenderer.send('streaming-playback-event', {
                type: 'title-started',
                url,
                positionSeconds: video.currentTime || 0,
                isPlaying: !video.paused,
            });
        }
        // ── Heartbeat periódico a cada 3.5 segundos enquanto houver título elegível ativo
        if (isWatchPartyEligibleUrl(url, video) &&
            !video.paused &&
            video.readyState >= 1 &&
            (now - lastHeartbeatTime) >= 3500) {
            lastHeartbeatTime = now;
            electron_1.ipcRenderer.send('streaming-playback-event', {
                type: 'heartbeat',
                url,
                positionSeconds: video.currentTime || 0,
                isPlaying: true,
            });
        }
    }
    // PROBLEMA 5: Deep-link auto play helper no Prime Video usando sessionStorage
    let shouldAutoPlay = false;
    try {
        shouldAutoPlay = sessionStorage.getItem('__concord_auto_play') === '1' || Boolean(window.__concord_auto_play);
    }
    catch (e) {
        shouldAutoPlay = Boolean(window.__concord_auto_play);
    }
    if (shouldAutoPlay) {
        const currentVideo = getActiveVideo();
        if (currentVideo && isVideoActuallyPlaying(currentVideo)) {
            try {
                sessionStorage.removeItem('__concord_auto_play');
            }
            catch (e) { }
            window.__concord_auto_play = false;
        }
        else {
            const playBtn = document.querySelector('[data-automation-id="playback-button"], a[href*="/watch/"], a[href*="/gp/video/detail"], button[aria-label*="Assistir agora"], button[aria-label*="Continuar assistindo"], button[aria-label*="Reproduzir"], button[aria-label*="Watch now"], button[aria-label*="Resume"]');
            if (playBtn) {
                try {
                    sessionStorage.removeItem('__concord_auto_play');
                }
                catch (e) { }
                window.__concord_auto_play = false;
                setTimeout(() => playBtn.click(), 500);
            }
        }
    }
}
// Observe e poll para mudanças de vídeo
setInterval(checkPlaybackState, 600);
window.addEventListener('DOMContentLoaded', checkPlaybackState);
window.addEventListener('popstate', () => {
    // URL mudou via SPA navigation — verificar logo após a transição
    setTimeout(checkPlaybackState, 300);
    setTimeout(checkPlaybackState, 1000);
});
// ── Receber comandos remotos do processo principal Concord ──
electron_1.ipcRenderer.on('apply-streaming-playback', (_event, data) => {
    // Cancelar retries anteriores se houver novo comando explícito (não autoDrift)
    if (!data.autoDrift && syncRetryTimer) {
        clearTimeout(syncRetryTimer);
        syncRetryTimer = null;
        syncRetryCount = 0;
    }
    applyPlaybackCommand(data);
});
function executeMainWorldPlayback(action, positionSeconds, deltaSeconds) {
    try {
        window.dispatchEvent(new CustomEvent('__concord_playback_cmd', {
            detail: { action, positionSeconds, deltaSeconds }
        }));
    }
    catch (e) { }
    const code = `
    (function() {
      try {
        if (typeof window.__concord_main_playback === 'function') {
          window.__concord_main_playback(${JSON.stringify(action)}, ${typeof positionSeconds === 'number' ? positionSeconds : 'undefined'}, ${typeof deltaSeconds === 'number' ? deltaSeconds : 'undefined'});
        }
      } catch(e) {}
    })();
  `;
    electron_1.webFrame.executeJavaScript(code).catch(() => { });
}
function applyPlaybackCommand(data, retryAttempt = 0) {
    // PROBLEMA 4: Janela de supressão robusta para evitar loops de echo / ping-pong
    isRemoteAction = true;
    const suppressionDuration = data.autoDrift ? 1000 : 2000;
    suppressLocalEventsUntil = Math.max(suppressLocalEventsUntil, Date.now() + suppressionDuration);
    if (remoteActionTimeout)
        clearTimeout(remoteActionTimeout);
    const video = getActiveVideo();
    if (!video) {
        // Executa comando no Main World mesmo sem elemento <video> detectado no preload (ex: player customizado)
        executeMainWorldPlayback(data.action, data.positionSeconds, data.deltaSeconds);
        if (retryAttempt < MAX_SYNC_RETRIES) {
            syncRetryCount = retryAttempt + 1;
            syncRetryTimer = setTimeout(() => {
                applyPlaybackCommand(data, retryAttempt + 1);
            }, SYNC_RETRY_DELAY_MS);
        }
        remoteActionTimeout = setTimeout(() => {
            isRemoteAction = false;
        }, suppressionDuration);
        return;
    }
    // Se a posição desejada é > 10s e o vídeo atual é curto (bumper de classificação/aviso < 45s)
    // ou se os metadados ainda não carregaram, guardar para aplicar assim que o filme começar
    if (typeof data.positionSeconds === 'number' && data.positionSeconds > 10) {
        const isShortBumper = !isNaN(video.duration) && video.duration > 0 && video.duration < 45;
        const isMetadataNotReady = isNaN(video.duration) || video.duration === 0 || video.readyState < 1;
        if (isShortBumper || isMetadataNotReady) {
            pendingSyncTarget = {
                action: data.action,
                positionSeconds: data.positionSeconds,
                deltaSeconds: data.deltaSeconds,
                timestamp: Date.now(),
            };
            if (retryAttempt < MAX_SYNC_RETRIES) {
                syncRetryTimer = setTimeout(() => {
                    applyPlaybackCommand(data, retryAttempt + 1);
                }, 1200);
            }
            remoteActionTimeout = setTimeout(() => {
                isRemoteAction = false;
            }, suppressionDuration);
            return;
        }
    }
    syncRetryCount = 0;
    // Auto-drift: se for apenas sincronização periódica de fundo, só aplica se a diferença for > 3.0s
    if (data.autoDrift && typeof data.positionSeconds === 'number') {
        const drift = Math.abs(video.currentTime - data.positionSeconds);
        if (drift < 3.0) {
            remoteActionTimeout = setTimeout(() => {
                isRemoteAction = false;
            }, 500);
            return;
        }
    }
    // PROBLEMA 1: Executar playback via Main World (API Cadmium na Netflix + controller principal)
    executeMainWorldPlayback(data.action, data.positionSeconds, data.deltaSeconds);
    if (data.action === 'seek' && typeof data.positionSeconds === 'number') {
        try {
            video.currentTime = data.positionSeconds;
        }
        catch (e) { }
    }
    else if (data.action === 'skip') {
        const step = typeof data.deltaSeconds === 'number' ? data.deltaSeconds : 10;
        try {
            video.currentTime = Math.min((video.duration || Infinity), video.currentTime + step);
        }
        catch (e) { }
    }
    else if (data.action === 'play') {
        if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.0) {
            try {
                video.currentTime = data.positionSeconds;
            }
            catch (e) { }
        }
        if (video.paused) {
            video.play().catch(() => { });
            // PROBLEMA 3: Só aciona o fallback de clique se após 200ms o vídeo ainda estiver pausado
            setTimeout(() => {
                const v = getActiveVideo();
                if (v && v.paused) {
                    clickPlayButton();
                }
            }, 200);
        }
    }
    else if (data.action === 'pause') {
        if (typeof data.positionSeconds === 'number' && Math.abs(video.currentTime - data.positionSeconds) > 2.0) {
            try {
                video.currentTime = data.positionSeconds;
            }
            catch (e) { }
        }
        if (!video.paused) {
            video.pause();
            // PROBLEMA 3: Só aciona o fallback de clique se após 200ms o vídeo continuar tocando
            setTimeout(() => {
                const v = getActiveVideo();
                if (v && !v.paused) {
                    clickPauseButton();
                }
            }, 200);
        }
    }
    // Verificação de segurança após 1.2s: se foi um seek explícito e o currentTime não mudou
    if (!data.autoDrift && typeof data.positionSeconds === 'number' && retryAttempt < 2) {
        const targetPos = data.positionSeconds;
        setTimeout(() => {
            const v = getActiveVideo();
            if (v && Math.abs(v.currentTime - targetPos) > 4.5 && (!v.duration || v.duration > 45)) {
                executeMainWorldPlayback('seek', targetPos);
                try {
                    v.currentTime = targetPos;
                }
                catch (e) { }
                if (data.action === 'play' && v.paused) {
                    executeMainWorldPlayback('play');
                    v.play().catch(() => { });
                    setTimeout(() => {
                        const curV = getActiveVideo();
                        if (curV && curV.paused)
                            clickPlayButton();
                    }, 200);
                }
            }
        }, 1200);
    }
    // Liberar isRemoteAction após a janela de supressão
    remoteActionTimeout = setTimeout(() => {
        isRemoteAction = false;
    }, suppressionDuration);
}
// ── Sinalizar ao Electron quando a view deve navegar automaticamente para um título
// (usado pelo Watch Party quando o receptor clica "Assistir Junto" ou "Sincronizar")
electron_1.ipcRenderer.on('navigate-to-title', (_event, data) => {
    // Ignora o redirecionamento de location.href se estiver em subframes (ex: iframe do player Vilos)
    if (window !== window.top) {
        return;
    }
    if (data.autoPlay) {
        try {
            sessionStorage.setItem('__concord_auto_play', '1');
        }
        catch (e) { }
        window.__concord_auto_play = true;
    }
    if (window.location.href !== data.url) {
        window.location.href = data.url;
    }
});
