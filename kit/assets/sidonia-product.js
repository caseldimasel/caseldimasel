/* SIDONIA · ficha de pieza
 *  - Barra de contacto fija en móvil: aparece cuando las acciones de contacto principales han
 *    quedado fuera de la vista y desaparece si el formulario de consulta está visible, si el teclado
 *    está abierto (un campo tiene el foco) o si se reproduce un vídeo con sonido (no tapa sus controles).
 *    Respeta el área segura inferior y no se acumula con otros botones flotantes del kit.
 *  - Analítica opcional: «vista de ficha» una sola vez por carga (sin datos personales).
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__product) return;
  S.__product = true;

  class SidoniaContactBar extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      var listing = this.closest('[data-sidonia-listing]');
      if (!listing) return;
      this.hidden = false;
      this.classList.add('is-hidden');
      this._actionsVisible = true;
      this._formVisible = false;
      this._typing = false;
      this._video = false;
      var actions = listing.querySelector('.sidonia-listing__card');
      var form = document.getElementById('sidonia-consulta');
      var self = this;
      // Posiciones leídas en cada fotograma de desplazamiento (no con IntersectionObserver: un salto de ancla o un
      // desplazamiento rápido que pasa por encima del resumen no cruza ningún umbral y dejaría el estado sin actualizar).
      var frame = 0;
      this._measure = function () {
        frame = 0;
        var vh = window.innerHeight;
        if (actions) {
          var a = actions.getBoundingClientRect();
          self._actionsVisible = a.bottom > 0; // visible o todavía por debajo
        }
        if (form) {
          var f = form.getBoundingClientRect();
          self._formVisible = f.top < vh && f.bottom > 0;
        }
        self._apply();
      };
      this._onScroll = function () {
        if (!frame) frame = requestAnimationFrame(self._measure);
      };
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('resize', this._onScroll, { passive: true });
      this._measure();
      this._onFocusIn = function (e) {
        var t = e.target;
        self._typing = !!(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        self._apply();
      };
      this._onFocusOut = function () {
        self._typing = false;
        self._apply();
      };
      document.addEventListener('focusin', this._onFocusIn);
      document.addEventListener('focusout', this._onFocusOut);
      this._onPlay = function () {
        self._video = true;
        self._apply();
        clearInterval(self._poll);
        self._poll = setInterval(function () {
          if (S.media && !S.media.anyPlaying()) {
            self._video = false;
            clearInterval(self._poll);
            self._apply();
          }
        }, 1000);
      };
      document.addEventListener('sidonia:video-play', this._onPlay);
      this._apply();
    }
    disconnectedCallback() {
      this._bound = false;
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onScroll);
      clearInterval(this._poll);
      document.removeEventListener('focusin', this._onFocusIn);
      document.removeEventListener('focusout', this._onFocusOut);
      document.removeEventListener('sidonia:video-play', this._onPlay);
      document.documentElement.style.removeProperty('--sidonia-toast-offset');
    }
    _apply() {
      var show = !this._actionsVisible && !this._formVisible && !this._typing && !this._video;
      this.classList.toggle('is-hidden', !show);
      this.setAttribute('aria-hidden', show ? 'false' : 'true');
      Array.prototype.forEach.call(this.querySelectorAll('a, button'), function (a) {
        if (show) a.removeAttribute('tabindex');
        else a.setAttribute('tabindex', '-1');
      });
      document.documentElement.style.setProperty('--sidonia-toast-offset', show ? this.offsetHeight + 'px' : '0px');
    }
  }
  S.define('sidonia-contact-bar', SidoniaContactBar);

  function trackView() {
    var listing = document.querySelector('[data-sidonia-listing]');
    if (!listing) return;
    S.track('view_listing', { category: listing.getAttribute('data-category') || '', ref: listing.getAttribute('data-ref') || '' }, 'view:' + listing.getAttribute('data-product-id'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackView);
  else trackView();
})();
