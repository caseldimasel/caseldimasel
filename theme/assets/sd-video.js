/* SIDONIA · vídeo
 *
 * Reglas:
 *  - Nunca hay audio automático: el sonido empieza solo tras un gesto del visitante.
 *  - En listados no se descarga ningún vídeo: la tarjeta lleva portada + botón; el recurso se crea al pulsar.
 *  - Solo un vídeo con sonido a la vez (S.media.claim).
 *  - Se pausa al salir del viewport y al cerrar el modal.
 *  - Previsualizaciones silenciosas solo si el navegador las acepta (play() puede rechazarse sin errores visibles),
 *    no hay «reducir movimiento», ahorro de datos ni móvil (salvo ajuste explícito).
 *  - YouTube/Vimeo se cargan solo al pedirlo y, si el ajuste lo exige, tras una confirmación.
 *  - Si el vídeo falla se muestra un mensaje útil; los datos y el contacto de la ficha siguen ahí.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__video) return;
  S.__video = true;

  /* ---------- registro de medios ---------- */
  var registry = new Set();
  S.media = {
    register: function (v) {
      registry.add(v);
    },
    unregister: function (v) {
      registry.delete(v);
    },
    /** Pausa cualquier otro vídeo audible antes de reproducir este. */
    claim: function (v) {
      registry.forEach(function (other) {
        if (other !== v && !other.paused && !other.muted) other.pause();
      });
    },
    pauseAll: function () {
      registry.forEach(function (v) {
        if (!v.paused) v.pause();
      });
    }
  };

  var YT = /^[\w-]{6,20}$/;
  var VM = /^\d{5,12}$/;

  function embedUrl(kind, id) {
    if (kind === 'youtube' && YT.test(id)) {
      return 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1';
    }
    if (kind === 'vimeo' && VM.test(id)) {
      return 'https://player.vimeo.com/video/' + id + '?autoplay=1&dnt=1';
    }
    return '';
  }

  function providerName(kind) {
    return kind === 'youtube' ? 'YouTube' : kind === 'vimeo' ? 'Vimeo' : '';
  }

  function consentGiven() {
    try {
      return sessionStorage.getItem('sd:ext-consent') === '1';
    } catch (e) {
      return false;
    }
  }
  function giveConsent() {
    try {
      sessionStorage.setItem('sd:ext-consent', '1');
    } catch (e) {}
  }

  function consentRequired() {
    return !!(S.config && S.config.video && S.config.video.externalConsent);
  }

  /** Normaliza lo que viene de data-video-* */
  function readData(el) {
    var d = el.dataset;
    var ratio = parseFloat(d.videoRatio);
    return {
      kind: d.videoKind || '',
      src: S.safeUrl(d.videoSrc),
      mime: d.videoMime || 'video/mp4',
      id: d.videoId || '',
      poster: S.safeUrl(d.videoPoster),
      preview: S.safeUrl(d.videoPreview),
      subs: S.safeUrl(d.videoSubs),
      subsLang: (d.videoSubsLang || 'es').slice(0, 12),
      ratio: ratio > 0.2 && ratio < 4 ? ratio : 0.5625,
      title: d.videoTitle || '',
      href: S.safeUrl(d.videoHref),
      duration: parseInt(d.videoDuration, 10) || 0
    };
  }

  /* ---------- creación de elementos ---------- */
  function milestones(video, kind) {
    var fired = {};
    var started = false;
    function reset() {
      fired = {};
      started = false;
    }
    video.addEventListener('playing', function () {
      if (started) return;
      started = true;
      S.track('video_start', { video_kind: kind });
    });
    video.addEventListener('timeupdate', function () {
      if (!video.duration || !isFinite(video.duration)) return;
      var pct = (video.currentTime / video.duration) * 100;
      [25, 50, 75].forEach(function (m) {
        if (pct >= m && !fired[m]) {
          fired[m] = true;
          S.track('video_progress', { milestone: m, video_kind: kind });
        }
      });
    });
    video.addEventListener('ended', function () {
      if (!fired[100]) {
        fired[100] = true;
        S.track('video_progress', { milestone: 100, video_kind: kind });
      }
      reset();
    });
    video.addEventListener('emptied', reset);
  }

  function buildVideo(data) {
    var v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.playsInline = true;
    v.controls = true;
    v.preload = 'auto';
    v.setAttribute('controlslist', 'nodownload');
    v.setAttribute('aria-label', data.title || '');
    if (data.poster) v.poster = data.poster;
    var hasTrack = !!data.subs;
    if (hasTrack) v.crossOrigin = 'anonymous';
    var source = document.createElement('source');
    source.src = data.src;
    source.type = data.mime;
    v.appendChild(source);
    if (hasTrack) {
      var tr = document.createElement('track');
      tr.kind = 'subtitles';
      tr.src = data.subs;
      tr.srclang = data.subsLang;
      tr.label = S.t('video.subtitles_label');
      v.appendChild(tr);
    }
    S.media.register(v);
    milestones(v, 'file');
    return v;
  }

  function destroyVideo(v) {
    if (!v) return;
    try {
      v.pause();
    } catch (e) {}
    S.media.unregister(v);
    v.removeAttribute('src');
    while (v.firstChild) v.removeChild(v.firstChild);
    try {
      v.load();
    } catch (e) {}
    if (v.parentNode) v.parentNode.removeChild(v);
  }

  function messageBox(className, text, actions) {
    var box = document.createElement('div');
    box.className = className;
    box.setAttribute('role', 'alert');
    var p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    (actions || []).forEach(function (a) {
      box.appendChild(a);
    });
    return box;
  }

  function button(label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Monta el reproductor dentro de `stage`. Devuelve { destroy() }.
   * `onFail` permite mostrar un mensaje distinto según el contexto.
   */
  function mountPlayer(stage, data, opts) {
    var state = { video: null, iframe: null, msg: null, destroyed: false };
    opts = opts || {};

    function clearMsg() {
      if (state.msg && state.msg.parentNode) state.msg.parentNode.removeChild(state.msg);
      state.msg = null;
    }

    function showError() {
      clearMsg();
      var retry = button(S.t('video.retry'), 'sd-btn sd-btn--light sd-btn--sm', function () {
        start();
      });
      state.msg = messageBox(opts.msgClass || 'sd-vstage__msg', S.t('video.error'), [retry]);
      if (opts.errorExtra) state.msg.appendChild(opts.errorExtra());
      stage.appendChild(state.msg);
      var first = state.msg.querySelector('button');
      if (first) first.focus();
    }

    function startFile() {
      cleanup();
      var v = buildVideo(data);
      var retriedWithoutCors = false;
      v.addEventListener('error', function onError() {
        if (state.destroyed) return;
        // Si falló por CORS al pedir subtítulos, reintenta sin ellos.
        if (v.crossOrigin && !retriedWithoutCors) {
          retriedWithoutCors = true;
          v.removeAttribute('crossorigin');
          var tracks = v.querySelectorAll('track');
          Array.prototype.forEach.call(tracks, function (t) {
            t.parentNode.removeChild(t);
          });
          v.load();
          v.play().catch(function () {});
          return;
        }
        destroyVideo(v);
        state.video = null;
        showError();
      });
      v.addEventListener('play', function () {
        S.media.claim(v);
        if (typeof opts.onPlay === 'function') opts.onPlay(v);
      });
      stage.appendChild(v);
      state.video = v;
      var p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function (err) {
          // Si el navegador no deja empezar solo, los controles nativos permiten pulsar play.
          if (err && err.name === 'NotAllowedError') return;
        });
      }
    }

    function startEmbed() {
      var url = embedUrl(data.kind, data.id);
      if (!url) {
        showError();
        return;
      }
      cleanup();
      var f = document.createElement('iframe');
      f.src = url;
      f.title = data.title || providerName(data.kind);
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.loading = 'lazy';
      stage.appendChild(f);
      state.iframe = f;
      S.track('video_start', { video_kind: data.kind });
    }

    function askConsent() {
      cleanup();
      var name = providerName(data.kind);
      var go = button(S.t('video.consent_button', { provider: name }), 'sd-btn sd-btn--light', function () {
        giveConsent();
        clearMsg();
        startEmbed();
      });
      var box = document.createElement('div');
      box.className = opts.consentClass || 'sd-vstage__msg';
      var p = document.createElement('p');
      p.textContent = S.t('video.consent_text', { provider: name });
      box.appendChild(p);
      box.appendChild(go);
      stage.appendChild(box);
      state.msg = box;
      go.focus();
    }

    function cleanup() {
      clearMsg();
      if (state.video) {
        destroyVideo(state.video);
        state.video = null;
      }
      if (state.iframe) {
        if (state.iframe.parentNode) state.iframe.parentNode.removeChild(state.iframe);
        state.iframe = null;
      }
    }

    function start() {
      if (data.kind === 'file' && data.src) {
        startFile();
      } else if (data.kind === 'youtube' || data.kind === 'vimeo') {
        if (consentRequired() && !consentGiven()) askConsent();
        else startEmbed();
      } else {
        showError();
      }
    }

    start();

    return {
      get video() {
        return state.video;
      },
      destroy: function () {
        state.destroyed = true;
        cleanup();
      },
      pause: function () {
        if (state.video && !state.video.paused) state.video.pause();
      }
    };
  }

  /* ---------- <sd-video-modal> ---------- */
  class SdVideoModal extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$dialog = this.querySelector('dialog');
      this.$title = this.querySelector('[data-sd-title]');
      this.$stage = this.querySelector('[data-sd-stage]');
      this.$link = this.querySelector('[data-sd-link]');
      this._player = null;
      this._trigger = null;

      this._onClose = this._cleanup.bind(this);
      this.$dialog.addEventListener('close', this._onClose);
      this._onCloseBtn = function () {
        S.closeDialog(this.$dialog);
      }.bind(this);
      var btn = this.querySelector('[data-sd-close]');
      if (btn) btn.addEventListener('click', this._onCloseBtn);
      S.closeOnBackdrop(this.$dialog);
      // Si el visitante cambia de pestaña, se pausa
      this._onVis = function () {
        if (document.hidden && this._player) this._player.pause();
      }.bind(this);
      document.addEventListener('visibilitychange', this._onVis);
    }

    disconnectedCallback() {
      this._bound = false;
      document.removeEventListener('visibilitychange', this._onVis);
      this._cleanup();
    }

    open(data, trigger) {
      this._trigger = trigger || document.activeElement;
      S.media.pauseAll();
      this._cleanup();
      this.$title.textContent = data.title || '';
      if (data.href) {
        this.$link.href = data.href;
        this.$link.hidden = false;
      } else {
        this.$link.hidden = true;
      }
      var stage = document.createElement('div');
      stage.className = 'sd-vstage';
      stage.style.setProperty('--sd-vratio', String(data.ratio));
      this.$stage.appendChild(stage);
      this._stageEl = stage;
      S.openDialog(this.$dialog);

      this._player = mountPlayer(stage, data, {
        errorExtra: function () {
          var wrap = document.createElement('div');
          if (data.href) {
            var a = document.createElement('a');
            a.className = 'sd-btn sd-btn--ghost sd-btn--sm';
            a.href = data.href;
            a.textContent = S.t('video.see_listing');
            a.style.color = '#fff';
            wrap.appendChild(a);
          }
          return wrap;
        }
      });
      this._data = data;
    }

    _cleanup() {
      if (this._player) {
        this._player.destroy();
        this._player = null;
      }
      if (this.$stage) this.$stage.innerHTML = '';
      var t = this._trigger;
      this._trigger = null;
      if (t && typeof t.focus === 'function' && document.contains(t) && (document.activeElement === document.body || !document.activeElement)) {
        t.focus();
      }
    }
  }
  S.define('sd-video-modal', SdVideoModal);

  // Un solo listener delegado para todos los botones de reproducir (tarjetas, hero, historia destacada).
  if (!S.__playBound) {
    S.__playBound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-sd-play]');
      if (!btn) return;
      var modal = document.querySelector('sd-video-modal');
      if (!modal || typeof modal.open !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      modal.open(readData(btn), btn);
    });
  }

  /* ---------- <sd-video-stage> (ficha de pieza) ---------- */
  class SdVideoStage extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$stage = this.querySelector('[data-sd-stage]');
      this.$start = this.querySelector('[data-sd-start]');
      this._data = readData(this);
      this._player = null;
      this._preview = null;

      this._onStart = this._start.bind(this);
      if (this.$start) this.$start.addEventListener('click', this._onStart);

      this._setupPreview();
      this._observePause();
    }

    disconnectedCallback() {
      this._bound = false;
      if (this.$start) this.$start.removeEventListener('click', this._onStart);
      if (this._io) this._io.disconnect();
      if (this._pauseIo) this._pauseIo.disconnect();
      this._removePreview();
      if (this._player) this._player.destroy();
      this._player = null;
    }

    _previewAllowed() {
      var d = this.dataset;
      if (!this._data.preview) return false;
      if (d.previewEnabled !== 'true') return false;
      if (S.prefersReducedMotion() || S.saveData()) return false;
      var mobile = window.matchMedia && window.matchMedia('(max-width: 899px), (pointer: coarse)').matches;
      if (mobile && d.previewMobile !== 'true') return false;
      return true;
    }

    _setupPreview() {
      if (!this._previewAllowed() || !('IntersectionObserver' in window)) return;
      var self = this;
      this._io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) self._playPreview();
            else self._pausePreview();
          });
        },
        { threshold: 0.4 }
      );
      this._io.observe(this.$stage);
    }

    _playPreview() {
      if (this._player || this._previewFailed) return;
      var self = this;
      if (!this._preview) {
        var v = document.createElement('video');
        v.className = 'sd-vplayer__preview';
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-hidden', 'true');
        v.tabIndex = -1;
        v.preload = 'metadata';
        v.src = this._data.preview;
        this.$stage.insertBefore(v, this.$start);
        this._preview = v;
      }
      var p = this._preview.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          if (self._preview) self._preview.classList.add('is-playing');
        }).catch(function () {
          // El navegador rechazó la reproducción automática: se queda la portada, sin errores visibles.
          self._previewFailed = true;
          self._removePreview();
        });
      }
    }

    _pausePreview() {
      if (this._preview && !this._preview.paused) this._preview.pause();
    }

    _removePreview() {
      if (this._preview) {
        try {
          this._preview.pause();
        } catch (e) {}
        this._preview.removeAttribute('src');
        if (this._preview.parentNode) this._preview.parentNode.removeChild(this._preview);
        this._preview = null;
      }
    }

    _start() {
      this._removePreview();
      if (this._io) this._io.disconnect();
      this.$stage.classList.add('is-started');
      if (this.$start) this.$start.hidden = true;
      S.media.pauseAll();
      this._player = mountPlayer(this.$stage, this._data, {
        msgClass: 'sd-vplayer__consent',
        consentClass: 'sd-vplayer__consent',
        errorExtra: function () {
          return document.createDocumentFragment();
        }
      });
      // Si falla, el mensaje solo cubre el reproductor: datos y contacto de la ficha siguen intactos.
    }

    /** Pausa el vídeo al salir del viewport (no lo reanuda solo). */
    _observePause() {
      if (!('IntersectionObserver' in window)) return;
      var self = this;
      this._pauseIo = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting && self._player) self._player.pause();
          });
        },
        { threshold: 0.15 }
      );
      this._pauseIo.observe(this.$stage);
    }
  }
  S.define('sd-video-stage', SdVideoStage);

  // Editor de temas: al descargar una sección se pausa todo
  document.addEventListener('shopify:section:unload', function () {
    S.media.pauseAll();
  });
})();
