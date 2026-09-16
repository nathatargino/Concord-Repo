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
      if (navigator.usb) {
        try { Object.defineProperty(navigator, 'usb', { get: function() { return undefined; } }); } catch(e) {}
      }
      if (navigator.hid) {
        try { Object.defineProperty(navigator, 'hid', { get: function() { return undefined; } }); } catch(e) {}
      }
    } catch(e) {}
  })();
`);
