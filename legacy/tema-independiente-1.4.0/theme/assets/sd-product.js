/* SIDONIA · ficha de pieza: compartir y barra fija de contacto en móvil */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__product) return;
  S.__product = true;

  /* <sd-share data-url data-title> : Web Share API si existe; si no, copiar enlace */
  class SdShare extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._btn = this.querySelector('[data-sd-share-btn]');
      this._onClick = this._share.bind(this);
      if (this._btn) this._btn.addEventListener('click', this._onClick);
      var canShare = typeof navigator.share === 'function';
      var canCopy = !!(navigator.clipboard && navigator.clipboard.writeText) || typeof document.execCommand === 'function';
      this.hidden = !(canShare || canCopy);
      if (!canShare && this._btn) {
        var label = this._btn.querySelector('span');
        if (label) label.textContent = S.t('product.copy_link');
      }
    }
    disconnectedCallback() {
      this._bound = false;
      if (this._btn) this._btn.removeEventListener('click', this._onClick);
    }
    _url() {
      return S.safeUrl(this.dataset.url) || location.href.split('#')[0];
    }
    _share() {
      var url = this._url();
      var title = this.dataset.title || document.title;
      var self = this;
      if (typeof navigator.share === 'function') {
        navigator.share({ title: title, url: url }).catch(function (err) {
          if (err && err.name === 'AbortError') return; // el visitante canceló
          self._copy(url);
        });
      } else {
        this._copy(url);
      }
    }
    _copy(url) {
      var done = function () {
        S.announce(S.t('product.link_copied'));
        S.toast(S.t('product.link_copied'));
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () {
          S.toast(url);
        });
        return;
      }
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {}
      document.body.removeChild(ta);
      if (ok) done();
      else S.toast(url);
    }
  }
  S.define('sd-share', SdShare);

  /* <sd-stickybar data-target="consulta"> : barra fija de contacto en móvil.
   * Se oculta cuando se ve el formulario, con el teclado abierto, con un modal abierto y en pantallas anchas. */
  class SdStickyBar extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._target = document.getElementById(this.dataset.target || 'consulta');
      this._formVisible = false;
      this._keyboard = false;
      this._mq = window.matchMedia('(max-width: 899px)');
      var self = this;
      this._update = function () {
        var modal = false;
        try {
          modal = !!document.querySelector('dialog:modal');
        } catch (e) {}
        var show = self._mq.matches && !self._formVisible && !self._keyboard && !modal;
        self.hidden = !show;
        document.body.classList.toggle('has-stickybar', show);
      };
      if (this._target && 'IntersectionObserver' in window) {
        this._io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            self._formVisible = en.isIntersecting;
          });
          self._update();
        });
        this._io.observe(this._target);
      }
      this._onFocusIn = function (e) {
        self._keyboard = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
        self._update();
      };
      this._onFocusOut = function () {
        self._keyboard = false;
        self._update();
      };
      document.addEventListener('focusin', this._onFocusIn);
      document.addEventListener('focusout', this._onFocusOut);
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._update);
      document.addEventListener('close', this._update, true);
      this._update();
    }
    disconnectedCallback() {
      this._bound = false;
      if (this._io) this._io.disconnect();
      document.removeEventListener('focusin', this._onFocusIn);
      document.removeEventListener('focusout', this._onFocusOut);
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._update);
      document.removeEventListener('close', this._update, true);
      document.body.classList.remove('has-stickybar');
    }
  }
  S.define('sd-stickybar', SdStickyBar);
})();
