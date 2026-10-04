/* SIDONIA · interfaz: galería de fotos con visor, carruseles y megamenú
 *
 * Todo es mejora progresiva: sin JavaScript la galería son enlaces a las fotos grandes, los carruseles se desplazan
 * con scroll táctil o de teclado y el megamenú es un menú de enlaces normal.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__ui) return;
  S.__ui = true;

  var reduce = function () {
    return S.prefersReducedMotion && S.prefersReducedMotion();
  };

  /* ---------- <sd-gallery> ---------- */
  class SdGallery extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$dialog = this.querySelector('dialog.sd-lightbox');
      this.$track = this.querySelector('[data-sd-lb-track]');
      this.$slides = this.$track ? this.$track.querySelectorAll('[data-sd-lb-slide]') : [];
      this.$pos = this.querySelector('[data-sd-lb-pos]');
      this.$grid = this.querySelector('[data-sd-gallery-track]');
      this.$gpos = this.querySelector('[data-sd-gallery-pos]');
      var all = this.querySelector('.sd-gallery__all');
      if (all) all.hidden = false;
      this._opener = null;

      this._onClick = this._click.bind(this);
      this.addEventListener('click', this._onClick);
      if (this.$dialog) {
        S.closeOnBackdrop(this.$dialog);
        this._onKey = this._key.bind(this);
        this.$dialog.addEventListener('keydown', this._onKey);
        this._onClose = function () {
          if (this._opener && document.contains(this._opener)) this._opener.focus({ preventScroll: true });
        }.bind(this);
        this.$dialog.addEventListener('close', this._onClose);
      }
      if (this.$track) {
        this._onTrack = this._trackScroll.bind(this);
        this.$track.addEventListener('scroll', this._onTrack, { passive: true });
      }
      if (this.$grid && this.$gpos) {
        this._onGrid = this._gridScroll.bind(this);
        this.$grid.addEventListener('scroll', this._onGrid, { passive: true });
      }
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      this.removeEventListener('click', this._onClick);
      if (this.$dialog) {
        this.$dialog.removeEventListener('keydown', this._onKey);
        this.$dialog.removeEventListener('close', this._onClose);
      }
      if (this.$track) this.$track.removeEventListener('scroll', this._onTrack);
      if (this.$grid && this._onGrid) this.$grid.removeEventListener('scroll', this._onGrid);
    }

    _click(e) {
      var open = e.target.closest('[data-sd-gallery-open]');
      if (open && this.$dialog) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
        e.preventDefault();
        this._opener = open;
        this.open(parseInt(open.getAttribute('data-sd-gallery-open'), 10) || 0);
        return;
      }
      if (e.target.closest('[data-sd-lb-close]')) {
        S.closeDialog(this.$dialog);
        return;
      }
      if (e.target.closest('[data-sd-lb-prev]')) this.go(-1);
      else if (e.target.closest('[data-sd-lb-next]')) this.go(1);
    }

    open(index) {
      S.openDialog(this.$dialog);
      var w = this.$track.clientWidth;
      this.$track.scrollTo({ left: w * index, behavior: 'auto' });
      this._setPos(index + 1);
    }

    go(dir) {
      var w = this.$track.clientWidth;
      var i = Math.round(this.$track.scrollLeft / w) + dir;
      i = Math.max(0, Math.min(this.$slides.length - 1, i));
      this.$track.scrollTo({ left: w * i, behavior: reduce() ? 'auto' : 'smooth' });
    }

    _key(e) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.go(-this.$slides.length);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.go(this.$slides.length);
      }
    }

    _setPos(n) {
      if (this.$pos) this.$pos.textContent = String(n);
    }

    _trackScroll() {
      var self = this;
      if (this._raf) return;
      this._raf = requestAnimationFrame(function () {
        self._raf = 0;
        var w = self.$track.clientWidth || 1;
        self._setPos(Math.round(self.$track.scrollLeft / w) + 1);
      });
    }

    _gridScroll() {
      var self = this;
      if (this._raf2) return;
      this._raf2 = requestAnimationFrame(function () {
        self._raf2 = 0;
        var item = self.$grid.firstElementChild;
        var w = item ? item.getBoundingClientRect().width : self.$grid.clientWidth;
        self.$gpos.textContent = String(Math.round(self.$grid.scrollLeft / (w || 1)) + 1);
      });
    }
  }
  S.define('sd-gallery', SdGallery);

  /* ---------- <sd-carousel> ---------- */
  class SdCarousel extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$track = this.querySelector('[data-sd-car-track]');
      this.$prev = this.querySelector('[data-sd-car-prev]');
      this.$next = this.querySelector('[data-sd-car-next]');
      if (!this.$track) return;
      this._onClick = function (e) {
        var p = e.target.closest('[data-sd-car-prev]');
        var n = e.target.closest('[data-sd-car-next]');
        if (p) this._scroll(-1);
        else if (n) this._scroll(1);
      }.bind(this);
      this.addEventListener('click', this._onClick);
      this._onScroll = this._update.bind(this);
      this.$track.addEventListener('scroll', this._onScroll, { passive: true });
      this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onScroll) : null;
      if (this._ro) this._ro.observe(this.$track);
      this.setAttribute('data-ready', '');
      this._update();
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      this.removeEventListener('click', this._onClick);
      if (this.$track) this.$track.removeEventListener('scroll', this._onScroll);
      if (this._ro) this._ro.disconnect();
    }

    _scroll(dir) {
      var step = this.$track.clientWidth * 0.9;
      this.$track.scrollBy({ left: dir * step, behavior: reduce() ? 'auto' : 'smooth' });
    }

    _update() {
      var t = this.$track;
      var max = t.scrollWidth - t.clientWidth;
      var overflow = max > 4;
      this.toggleAttribute('data-overflow', overflow);
      if (this.$prev) this.$prev.disabled = t.scrollLeft <= 2;
      if (this.$next) this.$next.disabled = t.scrollLeft >= max - 2;
    }
  }
  S.define('sd-carousel', SdCarousel);

  /* ---------- <sd-viewtoggle>: cuadrícula o lista ---------- */
  class SdViewToggle extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.hidden = false;
      this.$scope = this.closest('sd-facets') || document.body;
      var saved = null;
      try {
        saved = localStorage.getItem('sd:view');
      } catch (e) {}
      this._set(saved === 'list' ? 'list' : 'grid', false);
      this._onClick = function (e) {
        var b = e.target.closest('[data-sd-view]');
        if (b) this._set(b.getAttribute('data-sd-view'), true);
      }.bind(this);
      this.addEventListener('click', this._onClick);
    }
    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      this.removeEventListener('click', this._onClick);
    }
    _set(view, save) {
      this.$scope.setAttribute('data-view', view);
      Array.prototype.forEach.call(this.querySelectorAll('[data-sd-view]'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-sd-view') === view ? 'true' : 'false');
      });
      if (save) {
        try {
          localStorage.setItem('sd:view', view);
        } catch (e) {}
        S.announce(S.t(view === 'list' ? 'facets.view_list' : 'facets.view_grid'));
      }
    }
  }
  S.define('sd-viewtoggle', SdViewToggle);

  /* ---------- Altura real de la cabecera fija (para barras que se pegan debajo) ---------- */
  function trackHeader() {
    var el = document.querySelector('.shopify-section-group-header-group') || document.querySelector('sd-header');
    if (!el || typeof ResizeObserver !== 'function') return;
    var set = function () {
      document.documentElement.style.setProperty('--sd-header-h', Math.round(el.getBoundingClientRect().height) + 'px');
    };
    new ResizeObserver(set).observe(el);
    set();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackHeader);
  else trackHeader();

  /* ---------- Megamenú: Escape lo cierra y el foco se queda en su enlace ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var items = document.querySelectorAll('.sd-nav__item--mega');
    Array.prototype.forEach.call(items, function (li) {
      var focused = li.contains(document.activeElement);
      if (!focused && !li.matches(':hover')) return;
      li.classList.add('is-dismissed');
      var link = li.querySelector('.sd-nav__link');
      if (focused && link && document.activeElement !== link) link.focus();
      var clear = function () {
        li.classList.remove('is-dismissed');
        li.removeEventListener('mouseleave', clear);
        li.removeEventListener('focusout', onOut);
      };
      var onOut = function (ev) {
        if (!li.contains(ev.relatedTarget)) clear();
      };
      li.addEventListener('mouseleave', clear);
      li.addEventListener('focusout', onOut);
    });
  });
})();
