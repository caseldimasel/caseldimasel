/* SIDONIA · cabecera: cajón de navegación, buscador y búsqueda predictiva
 * <sd-header> envuelve la cabecera. Usa <dialog> nativo: foco, Escape y restauración del foco los gestiona el navegador.
 * La búsqueda predictiva usa la API oficial de Shopify (Section Rendering sobre /search/suggest) y solo
 * habla con la propia tienda: no envía el texto a ninguna analítica.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__header) return;
  S.__header = true;

  class SdHeader extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$drawer = this.querySelector('.sd-drawer');
      this.$search = this.querySelector('.sd-searchdlg');
      this.$input = this.querySelector('[data-sd-suggest-input]');
      this.$results = this.querySelector('[data-sd-suggest-results]');
      this._abort = null;

      this._onClick = this._click.bind(this);
      this.addEventListener('click', this._onClick);

      [this.$drawer, this.$search].forEach(function (d) {
        if (d) S.closeOnBackdrop(d);
      });

      if (this.classList.contains('sd-header--sticky')) {
        this._onScroll = this._scroll.bind(this);
        window.addEventListener('scroll', this._onScroll, { passive: true });
        this._scroll();
      }

      if (this.$input) {
        this._onInput = S.debounce(this._suggest.bind(this), 250);
        this.$input.addEventListener('input', this._onInput);
        this._onKey = this._key.bind(this);
        this.$search.addEventListener('keydown', this._onKey);
        // En un campo de búsqueda, Escape borra el texto en lugar de cerrar: aquí debe cerrar el diálogo.
        this._onInputKey = function (e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            S.closeDialog(this.$search);
          }
        }.bind(this);
        this.$input.addEventListener('keydown', this._onInputKey);
      }

      // Si se vuelve con atrás (bfcache) no deben quedar cajones abiertos
      this._onPageShow = function (e) {
        if (e.persisted) {
          S.closeDialog(this.$drawer);
          S.closeDialog(this.$search);
        }
      }.bind(this);
      window.addEventListener('pageshow', this._onPageShow);
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      this.removeEventListener('click', this._onClick);
      if (this._onScroll) window.removeEventListener('scroll', this._onScroll);
      if (this.$input && this._onInput) this.$input.removeEventListener('input', this._onInput);
      if (this.$input && this._onInputKey) this.$input.removeEventListener('keydown', this._onInputKey);
      if (this.$search && this._onKey) this.$search.removeEventListener('keydown', this._onKey);
      window.removeEventListener('pageshow', this._onPageShow);
      if (this._abort) this._abort.abort();
    }

    _click(e) {
      var opener = e.target.closest('[data-sd-open]');
      if (opener) {
        var which = opener.getAttribute('data-sd-open');
        var target = which === 'search' ? this.$search : this.$drawer;
        if (target) {
          e.preventDefault();
          if (which === 'search') S.closeDialog(this.$drawer);
          S.openDialog(target);
          if (which === 'search' && this.$input) {
            this.$input.focus();
            this.$input.select();
          }
        }
        return;
      }
      var closer = e.target.closest('[data-sd-close]');
      if (closer) {
        var dlg = closer.closest('dialog');
        if (dlg) S.closeDialog(dlg);
      }
    }

    _scroll() {
      if (this._raf) return;
      var self = this;
      this._raf = requestAnimationFrame(function () {
        self._raf = 0;
        self.classList.toggle('is-stuck', window.scrollY > 8);
      });
    }

    _key(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var links = Array.prototype.slice.call(this.$results.querySelectorAll('a'));
      if (!links.length) return;
      var i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        links[Math.min(i + 1, links.length - 1)].focus();
      } else if (i >= 0) {
        e.preventDefault();
        if (i === 0) this.$input.focus();
        else links[i - 1].focus();
      }
    }

    _suggest() {
      var q = (this.$input.value || '').trim();
      var routes = (S.config && S.config.routes) || {};
      if (q.length < 2 || !routes.predictiveSearch) {
        this.$results.innerHTML = '';
        return;
      }
      if (this._abort) this._abort.abort();
      this._abort = typeof AbortController === 'function' ? new AbortController() : null;
      var url =
        routes.predictiveSearch +
        '?q=' +
        encodeURIComponent(q) +
        '&section_id=predictive-search&resources[type]=product&resources[limit]=4&resources[limit_scope]=each' +
        '&resources[options][fields]=title,product_type,tag,vendor&resources[options][unavailable_products]=last';
      var self = this;
      this.$results.setAttribute('aria-busy', 'true');
      fetch(url, { signal: this._abort ? this._abort.signal : undefined, headers: { Accept: 'text/html' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          var doc = S.parseHTML(text);
          var section = doc.querySelector('.shopify-section') || doc.body;
          self.$results.innerHTML = section.innerHTML;
          var n = self.$results.querySelectorAll('.sd-suggest__item').length;
          S.announce(n ? S.t('search.suggestions_count', { count: n }) : S.t('search.no_suggestions'));
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          self.$results.innerHTML = '';
        })
        .then(function () {
          self.$results.removeAttribute('aria-busy');
        });
    }
  }
  S.define('sd-header', SdHeader);
})();
