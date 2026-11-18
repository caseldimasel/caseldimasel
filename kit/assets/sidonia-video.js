/* SIDONIA · vídeo
 *
 * Reglas (briefing §12):
 *  - Nunca hay audio automático: el sonido empieza tras un gesto explícito.
 *  - Los listados no descargan vídeos: portada + botón; el recurso se crea al pulsar.
 *  - Solo un vídeo con sonido a la vez (S.media.claim).
 *  - Se pausa al salir del viewport, al cambiar de pestaña y al cerrar el modal.
 *  - Previsualizaciones silenciosas solo si el navegador las acepta, sin «reducir movimiento»
 *    ni ahorro de datos; si play() se rechaza, se queda la portada sin errores visibles.
 *  - YouTube/Vimeo se cargan al pedirlo (youtube-nocookie) y, si el ajuste lo exige, tras aceptar.
 *  - Si el vídeo falla: mensaje útil con reintento; los datos y el contacto siguen en la página.
 *  - Hitos 25/50/75/100 una vez por reproducción (analítica opcional, sin datos personales).
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__video) return;
  S.__video = true;

  /* ---------------------------------------------------------------- registro */
  var registry = new Set();
  S.media = {
    register: function (v) {
      registry.add(v);
    },
    unregister: function (v) {
      registry.delete(v);
    },
    claim: function (v) {
      registry.forEach(function (other) {
        if (other !== v && !other.paused && !other.muted) other.pause();
      });
      S.emit('sidonia:video-play', {});
    },
    pauseAll: function () {
      registry.forEach(function (v) {
        if (!v.paused) v.pause();
      });
    },
    anyPlaying: function () {
      var playing = false;
      registry.forEach(function (v) {
        if (!v.paused && !v.muted) playing = true;
      });
      return playing;
    }
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) S.media.pauseAll();
  });

  var YT = /^[\w-]{6,20}$/;
  var VM = /^\d{5,12}$/;

  function embedUrl(kind, id) {
    if (kind === 'youtube' && YT.test(id)) return 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1';
    if (kind === 'vimeo' && VM.test(id)) return 'https://player.vimeo.com/video/' + id + '?autoplay=1&dnt=1';
    return '';
  }

  function providerName(kind) {
    return kind === 'youtube' ? 'YouTube' : kind === 'vimeo' ? 'Vimeo' : '';
  }

  function consentRequired() {
    return !!(S.config.video && S.config.video.externalConsent);
  }
  function consentGiven() {
    try {
      return sessionStorage.getItem('sidonia:ext-video') === '1';
    } catch (e) {
      return false;
    }
  }
  function giveConsent() {
    try {
      sessionStorage.setItem('sidonia:ext-video', '1');
    } catch (e) {}
  }

  function smallScreen() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 749px)').matches);
  }

  function readData(el) {
    var d = el.dataset;
    var ratio = parseFloat(d.videoRatio);
    var src = S.safeUrl(d.videoSrc);
    var sd = S.safeUrl(d.videoSrcSd);
    return {
      kind: d.videoKind || '',
      src: (S.saveData() || smallScreen()) && sd ? sd : src,
      mime: d.videoMime || 'video/mp4',
      id: d.videoId || '',
      poster: S.safeUrl(d.videoPoster),
      preview: S.safeUrl(d.videoPreview),
      subs: S.safeUrl(d.videoSubs),
      subsLang: (d.videoSubsLang || 'es').slice(0, 12),
      ratio: ratio > 0.2 && ratio < 4 ? ratio : 0.5625,
      title: d.videoTitle || '',
      href: S.safeUrl(d.videoHref),
      social: S.safeUrl(d.videoSocial),
      lang: d.videoLang || '',
      duration: parseInt(d.videoDuration, 10) || 0
    };
  }

  /* ---------------------------------------------------------------- piezas del reproductor */

  function milestones(video, kind) {
    var fired = {};
    var started = false;
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
      if (!fired[100]) S.track('video_progress', { milestone: 100, video_kind: kind });
      fired = {};
      started = false;
    });
  }

  /** Subtítulos: se descargan con fetch y se sirven como blob (evita exigir CORS al vídeo). */
  function attachSubtitles(video, data) {
    if (!data.subs || typeof fetch !== 'function') return;
    fetch(data.subs, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('subs');
        return r.text();
      })
      .then(function (text) {
        if (!/^﻿?WEBVTT/.test(text)) return;
        var url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
        var tr = document.createElement('track');
        tr.kind = 'subtitles';
        tr.src = url;
        tr.srclang = data.subsLang;
        tr.label = S.t('videoSubtitles');
        video.appendChild(tr);
        video._sidoniaBlob = url;
      })
      .catch(function () {
        /* Sin subtítulos, la transcripción de la ficha sigue disponible. */
      });
  }

  function prepareVideo(v, data) {
    v.setAttribute('playsinline', '');
    v.playsInline = true;
    v.controls = true;
    v.muted = false;
    v.removeAttribute('autoplay');
    v.removeAttribute('muted');
    v.setAttribute('controlslist', 'nodownload');
    if (data.title) v.setAttribute('aria-label', data.title);
    attachSubtitles(v, data);
    S.media.register(v);
    milestones(v, 'file');
    return v;
  }

  function buildVideo(data) {
    var v = document.createElement('video');
    if (data.poster) v.poster = data.poster;
    v.preload = 'auto';
    var source = document.createElement('source');
    source.src = data.src;
    source.type = data.mime;
    v.appendChild(source);
    return prepareVideo(v, data);
  }

  function destroyVideo(v) {
    if (!v) return;
    try {
      v.pause();
    } catch (e) {}
    S.media.unregister(v);
    if (v._sidoniaBlob) URL.revokeObjectURL(v._sidoniaBlob);
    v.removeAttribute('src');
    while (v.firstChild) v.removeChild(v.firstChild);
    try {
      v.load();
    } catch (e) {}
    v.remove();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  /**
   * Monta un reproductor dentro de `stage` (que ya reserva la proporción). Devuelve { destroy, pause }.
   * opts.template: <template> con el video_tag de Shopify (fuentes HLS + MP4) para el vídeo alojado.
   */
  function mountPlayer(stage, data, opts) {
    opts = opts || {};
    var state = { video: null, iframe: null, msg: null, destroyed: false };

    function clearMsg() {
      if (state.msg) state.msg.remove();
      state.msg = null;
    }

    function cleanup() {
      clearMsg();
      if (state.video) {
        destroyVideo(state.video);
        state.video = null;
      }
      if (state.iframe) {
        state.iframe.remove();
        state.iframe = null;
      }
    }

    function showError() {
      cleanup();
      var box = el('div', 'sidonia-player__msg');
      box.setAttribute('role', 'alert');
      box.appendChild(el('p', '', S.t('videoError')));
      var retry = el('button', 'sidonia-btn sidonia-btn--light sidonia-btn--sm', S.t('videoRetry'));
      retry.type = 'button';
      retry.addEventListener('click', start);
      box.appendChild(retry);
      if (opts.listingLink && data.href) {
        var a = el('a', 'sidonia-link', S.t('videoSeeListing'));
        a.href = data.href;
        a.style.color = '#fff';
        box.appendChild(a);
      }
      stage.appendChild(box);
      state.msg = box;
      retry.focus();
    }

    function startFile() {
      cleanup();
      var v = null;
      if (opts.template && opts.template.content) {
        var clone = opts.template.content.querySelector('video');
        if (clone) {
          v = prepareVideo(document.importNode(clone, true), data);
          v.preload = 'auto';
        }
      }
      if (!v) {
        if (!data.src) return showError();
        v = buildVideo(data);
      }
      v.addEventListener(
        'error',
        function (e) {
          if (state.destroyed) return;
          // Con varias <source>, el navegador prueba la siguiente: solo es fatal el fallo de la última.
          var t = e && e.target;
          if (t && t.tagName === 'SOURCE') {
            var nextSource = t.nextElementSibling;
            while (nextSource && nextSource.tagName !== 'SOURCE') nextSource = nextSource.nextElementSibling;
            if (nextSource) return;
          }
          destroyVideo(v);
          state.video = null;
          showError();
        },
        true
      );
      v.addEventListener('play', function () {
        S.media.claim(v);
      });
      stage.appendChild(v);
      state.video = v;
      var p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          /* Si el navegador no deja empezar, los controles visibles permiten pulsar play. */
        });
      }
    }

    function startEmbed() {
      var url = embedUrl(data.kind, data.id);
      if (!url) return showError();
      cleanup();
      S.media.pauseAll();
      var f = document.createElement('iframe');
      f.src = url;
      f.title = data.title || providerName(data.kind);
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      stage.appendChild(f);
      state.iframe = f;
      S.track('video_start', { video_kind: data.kind });
    }

    function askConsent() {
      cleanup();
      var name = providerName(data.kind);
      var box = el('div', 'sidonia-player__msg sidonia-player__consent');
      box.appendChild(el('p', '', S.t('videoConsent', { provider: name })));
      var go = el('button', 'sidonia-btn sidonia-btn--light sidonia-btn--sm', S.t('videoConsentButton', { provider: name }));
      go.type = 'button';
      go.addEventListener('click', function () {
        giveConsent();
        startEmbed();
      });
      box.appendChild(go);
      stage.appendChild(box);
      state.msg = box;
      go.focus();
    }

    function start() {
      if (data.kind === 'file') startFile();
      else if (data.kind === 'youtube' || data.kind === 'vimeo') {
        if (consentRequired() && !consentGiven()) askConsent();
        else startEmbed();
      } else showError();
    }

    start();
    return {
      destroy: function () {
        state.destroyed = true;
        cleanup();
      },
      pause: function () {
        if (state.video && !state.video.paused) state.video.pause();
        if (state.iframe) {
          // Un iframe de terceros no se puede pausar sin su API: se descarga al salir.
          state.iframe.remove();
          state.iframe = null;
        }
      },
      get video() {
        return state.video;
      }
    };
  }

  /* ---------------------------------------------------------------- modal compartido */
  var modal = {
    dialog: null,
    slot: null,
    title: null,
    player: null,
    trigger: null,
    bind: function () {
      var d = document.getElementById('sidonia-video-modal');
      if (!d || d === this.dialog) return !!d;
      this.dialog = d;
      this.slot = d.querySelector('[data-sidonia-video-slot]');
      this.title = d.querySelector('.sidonia-modal__title');
      var self = this;
      d.addEventListener('close', function () {
        self.cleanup();
      });
      d.addEventListener('click', function (e) {
        if (e.target === d || (e.target.closest && e.target.closest('[data-sidonia-close]'))) S.closeDialog(d);
      });
      return true;
    },
    open: function (data, trigger) {
      if (!this.bind()) return false;
      this.trigger = trigger || document.activeElement;
      S.media.pauseAll();
      this.cleanup(true);
      if (this.title) this.title.textContent = data.title || this.title.textContent;
      var stage = el('div', 'sidonia-player');
      stage.style.setProperty('--sidonia-video-ratio', String(data.ratio));
      if (data.ratio < 1) {
        stage.classList.add('sidonia-player--portrait');
        stage.style.setProperty('--sidonia-player-max-h', 'calc(100dvh - 9rem)');
      }
      this.slot.appendChild(stage);
      var meta = el('div', 'sidonia-video-modal__meta');
      var left = el('span', '', data.lang ? S.t('videoLanguage', { lang: data.lang }) : '');
      meta.appendChild(left);
      var links = el('span');
      if (data.social) {
        var so = el('a', '', S.t('videoOriginal'));
        so.href = data.social;
        so.target = '_blank';
        so.rel = 'noopener';
        links.appendChild(so);
        links.appendChild(document.createTextNode('  '));
      }
      if (data.href && data.href.split('#')[0] !== location.href.split('#')[0]) {
        var li = el('a', '', S.t('videoSeeListing'));
        li.href = data.href;
        links.appendChild(li);
      }
      meta.appendChild(links);
      this.slot.appendChild(meta);
      S.openDialog(this.dialog);
      this.player = mountPlayer(stage, data, { listingLink: true });
      return true;
    },
    cleanup: function (keepFocus) {
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
      if (this.slot) this.slot.innerHTML = '';
      if (keepFocus) return;
      var t = this.trigger;
      this.trigger = null;
      if (t && typeof t.focus === 'function' && document.contains(t)) t.focus();
    }
  };

  if (!S.__playBound) {
    S.__playBound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-sidonia-play]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      modal.open(readData(btn), btn);
    });
  }

  /* ---------------------------------------------------------------- reproductor en la página */
  class SidoniaPlayer extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._data = readData(this);
      this._start = this.querySelector('[data-sidonia-player-start]');
      this._tpl = this.querySelector('template[data-sidonia-video-template]');
      this._player = null;
      this._onStart = this.start.bind(this);
      if (this._start) this._start.addEventListener('click', this._onStart);
      this._observe();
      this._setupPreview();
    }
    disconnectedCallback() {
      this._bound = false;
      if (this._start) this._start.removeEventListener('click', this._onStart);
      if (this._io) this._io.disconnect();
      if (this._pio) this._pio.disconnect();
      this._removePreview();
      if (this._player) this._player.destroy();
      this._player = null;
    }
    start() {
      this._removePreview();
      if (this._pio) this._pio.disconnect();
      if (this._start) this._start.hidden = true;
      this.classList.add('is-started');
      S.media.pauseAll();
      this._player = mountPlayer(this, this._data, { template: this._tpl });
    }
    _observe() {
      if (!('IntersectionObserver' in window)) return;
      var self = this;
      this._io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting && self._player) self._player.pause();
          });
        },
        { threshold: 0.2 }
      );
      this._io.observe(this);
    }
    _previewAllowed() {
      if (!this._data.preview || !(S.config.video && S.config.video.pagePreview)) return false;
      if (S.prefersReducedMotion() || S.saveData()) return false;
      return !(window.matchMedia && window.matchMedia('(max-width: 899px), (pointer: coarse)').matches);
    }
    _setupPreview() {
      if (!this._previewAllowed() || !('IntersectionObserver' in window)) return;
      var self = this;
      this._pio = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) self._playPreview();
            else if (self._preview) self._preview.pause();
          });
        },
        { threshold: 0.4 }
      );
      this._pio.observe(this);
    }
    _playPreview() {
      if (this._player || this._previewFailed) return;
      var self = this;
      if (!this._preview) {
        var v = document.createElement('video');
        v.className = 'sidonia-card__preview';
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.playsInline = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-hidden', 'true');
        v.tabIndex = -1;
        v.preload = 'metadata';
        v.src = this._data.preview;
        this.insertBefore(v, this._start);
        this._preview = v;
      }
      var p = this._preview.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          self._previewFailed = true;
          self._removePreview();
        });
      }
    }
    _removePreview() {
      if (!this._preview) return;
      try {
        this._preview.pause();
      } catch (e) {}
      this._preview.removeAttribute('src');
      this._preview.remove();
      this._preview = null;
    }
  }
  S.define('sidonia-player', SidoniaPlayer);

  /* ---------------------------------------------------------------- vista previa en tarjetas (opcional) */
  /*
   * Desactivada por defecto. Solo con puntero fino (escritorio), sin reducir movimiento ni ahorro de
   * datos, tras 300 ms sobre la portada y con el clip breve de la pieza (sidonia.preview_clip).
   * El clip se crea al pasar el ratón y se elimina al salir: el listado no descarga vídeos al cargar.
   */
  if (!S.__cardPreview && S.config.video && S.config.video.cardPreview) {
    S.__cardPreview = true;
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine && !S.prefersReducedMotion() && !S.saveData()) {
      var timer = null;
      var current = null;
      document.addEventListener('pointerover', function (e) {
        var media = e.target.closest && e.target.closest('.sidonia-card__media');
        if (!media || media === current) return;
        var btn = media.querySelector('[data-sidonia-play][data-video-preview]');
        if (!btn) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          stopCard();
          var src = S.safeUrl(btn.getAttribute('data-video-preview'));
          if (!src) return;
          var v = document.createElement('video');
          v.className = 'sidonia-card__preview';
          v.muted = true;
          v.loop = true;
          v.playsInline = true;
          v.setAttribute('muted', '');
          v.setAttribute('playsinline', '');
          v.setAttribute('aria-hidden', 'true');
          v.preload = 'auto';
          v.src = src;
          media.querySelector('.sidonia-card__cover').appendChild(v);
          current = media;
          v.play().catch(function () {
            stopCard();
          });
        }, 300);
      });
      document.addEventListener('pointerout', function (e) {
        var media = e.target.closest && e.target.closest('.sidonia-card__media');
        if (!media) return;
        if (e.relatedTarget && media.contains(e.relatedTarget)) return;
        clearTimeout(timer);
        if (media === current) stopCard();
      });
      function stopCard() {
        if (!current) return;
        var v = current.querySelector('.sidonia-card__preview');
        if (v) {
          v.pause();
          v.removeAttribute('src');
          v.remove();
        }
        current = null;
      }
    }
  }

  document.addEventListener('shopify:section:unload', function () {
    S.media.pauseAll();
  });
})();
