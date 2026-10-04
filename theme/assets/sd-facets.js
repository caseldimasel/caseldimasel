/* SIDONIA · filtros, orden y «Cargar más»
 *
 * Mejora progresiva sobre filtros que ya funcionan sin JavaScript (formulario GET + paginación real).
 *  - Cada cambio consulta a Shopify (Storefront Filtering / Search & Discovery) con la Section Rendering API:
 *    se filtra TODO el catálogo, nunca solo las tarjetas visibles.
 *  - El estado vive en la URL: recargar, compartir, atrás y adelante funcionan (pushState + popstate).
 *  - Si algo falla, se navega a la URL normal (el servidor siempre tiene la respuesta correcta).
 *  - «Cargar más» usa la misma URL «siguiente» que la paginación real y recuerda cuántas páginas se cargaron
 *    para restaurar la posición al volver desde una ficha.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__facets) return;
  S.__facets = true;

  var SWAPS = ['toggle', 'count', 'filters', 'apply', 'active', 'grid', 'pagination'];

  class SdFacets extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.sectionId = this.dataset.sectionId;
      this.form = this.querySelector('[data-sd-facets-form]');
      this.dialog = this.querySelector('.sd-filters');
      this.results = this.querySelector('[data-sd-results]');
      if (!this.form || !this.results) return;
      this._abort = null;
      this._pages = 1;
      this._modal = false;

      this._onChange = S.debounce(this._changed.bind(this), 280);
      this.form.addEventListener('change', this._onChange);
      this._onSubmit = function (e) {
        e.preventDefault();
        this._apply();
      }.bind(this);
      this.form.addEventListener('submit', this._onSubmit);
      this._onClick = this._click.bind(this);
      this.addEventListener('click', this._onClick);
      this._onPop = function () {
        this._load(location.href, { popstate: true });
      }.bind(this);
      window.addEventListener('popstate', this._onPop);

      // Panel: lateral en escritorio, modal en móvil
      this._mq = window.matchMedia('(min-width: 1024px)');
      this._onMq = this._layout.bind(this);
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      if (this.dialog) {
        this._onDialogClose = function () {
          this._modal = false;
        }.bind(this);
        this.dialog.addEventListener('close', this._onDialogClose);
        S.closeOnBackdrop(this.dialog);
      }
      this._layout();

      this._remember();
      this._restore();
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      if (this.form) {
        this.form.removeEventListener('change', this._onChange);
        this.form.removeEventListener('submit', this._onSubmit);
      }
      this.removeEventListener('click', this._onClick);
      window.removeEventListener('popstate', this._onPop);
      if (this._mq && this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
      if (this.dialog && this._onDialogClose) this.dialog.removeEventListener('close', this._onDialogClose);
      if (this._saveHandler) {
        this.removeEventListener('click', this._saveHandler);
        window.removeEventListener('pagehide', this._saveHandler);
        this._rememberBound = false;
      }
      if (this._abort) this._abort.abort();
    }

    /* ---------- panel de filtros ---------- */
    _layout() {
      if (!this.dialog) return;
      var desktop = this._mq.matches;
      if (desktop) {
        if (this._modal) {
          this.dialog.close();
          this._modal = false;
        }
        if (!this.dialog.open) this.dialog.show();
      } else if (!this._modal && this.dialog.open) {
        // En móvil el panel empieza cerrado; se abre con el botón «Filtros».
        this.dialog.close();
      }
    }

    _openFilters() {
      if (!this.dialog) return;
      if (this._mq.matches) return;
      if (this.dialog.open) this.dialog.close();
      this._modal = true;
      S.openDialog(this.dialog);
    }

    _closeFilters() {
      if (!this.dialog) return;
      if (this._mq.matches) return;
      S.closeDialog(this.dialog);
      this._modal = false;
      var toggle = this.querySelector('[data-sd-open-filters]');
      if (toggle) toggle.focus();
    }

    /* ---------- interacción ---------- */
    _click(e) {
      var open = e.target.closest('[data-sd-open-filters]');
      if (open) {
        e.preventDefault();
        this._openFilters();
        return;
      }
      var close = e.target.closest('[data-sd-close-filters]');
      if (close) {
        e.preventDefault();
        this._closeFilters();
        return;
      }
      var more = e.target.closest('[data-sd-load-more]');
      if (more) {
        e.preventDefault();
        this._loadMore(more);
        return;
      }
      var link = e.target.closest('a[data-sd-facet-link]');
      if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
        e.preventDefault();
        this._load(link.href, {});
      }
    }

    _changed() {
      this._apply();
    }

    /** Construye la URL a partir del formulario (sin parámetros vacíos y volviendo a la página 1). */
    _buildUrl() {
      var url = new URL(this.form.getAttribute('action') || location.pathname, location.origin);
      var fd = new FormData(this.form);
      fd.forEach(function (value, key) {
        if (typeof value !== 'string' || value === '') return;
        if (key === 'page') return;
        url.searchParams.append(key, value);
      });
      return url.pathname + url.search;
    }

    _apply() {
      this._load(this._buildUrl(), {});
    }

    _sectionUrl(url) {
      var u = new URL(url, location.origin);
      u.searchParams.set('section_id', this.sectionId);
      return u.pathname + u.search;
    }

    _fetch(url) {
      if (this._abort) this._abort.abort();
      this._abort = typeof AbortController === 'function' ? new AbortController() : null;
      return fetch(this._sectionUrl(url), {
        headers: { Accept: 'text/html' },
        credentials: 'same-origin',
        signal: this._abort ? this._abort.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      });
    }

    _busy(on) {
      this.results.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    _focusSnapshot() {
      var a = document.activeElement;
      if (!a || !this.contains(a) || !a.name) return null;
      return { name: a.name, value: a.value, type: a.type };
    }

    _restoreFocus(snap) {
      if (!snap) return;
      var sel = '[name="' + (window.CSS && CSS.escape ? CSS.escape(snap.name) : snap.name) + '"]';
      var cands = this.querySelectorAll(sel);
      for (var i = 0; i < cands.length; i++) {
        if (snap.type === 'checkbox' && cands[i].value !== snap.value) continue;
        if (!cands[i].disabled) {
          cands[i].focus({ preventScroll: true });
          return;
        }
      }
    }

    /** Sustituye las zonas marcadas con data-sd-swap por las del servidor. */
    _swap(doc) {
      var self = this;
      var openState = {};
      Array.prototype.forEach.call(this.querySelectorAll('.sd-fgroup'), function (d) {
        openState[d.getAttribute('data-group')] = d.open;
      });
      var snap = this._focusSnapshot();

      SWAPS.forEach(function (key) {
        var cur = self.querySelector('[data-sd-swap="' + key + '"]');
        var nxt = doc.querySelector('[data-sd-swap="' + key + '"]');
        if (cur && nxt) cur.innerHTML = nxt.innerHTML;
      });
      // El selector de orden no se sustituye, pero se sincroniza
      var sortNew = doc.querySelector('[data-sd-sort]');
      var sortCur = this.querySelector('[data-sd-sort]');
      if (sortNew && sortCur) sortCur.value = sortNew.value;

      Array.prototype.forEach.call(this.querySelectorAll('.sd-fgroup'), function (d) {
        var k = d.getAttribute('data-group');
        if (Object.prototype.hasOwnProperty.call(openState, k)) d.open = openState[k];
      });
      this._restoreFocus(snap);
    }

    _load(url, opts) {
      var self = this;
      this._busy(true);
      return this._fetch(url)
        .then(function (text) {
          var doc = S.parseHTML(text);
          self._swap(doc);
          self._pages = 1;
          if (!opts.popstate && !opts.replace) history.pushState({ sdFacets: true }, '', url);
          if (opts.replace) history.replaceState({ sdFacets: true }, '', url);
          var count = S.text(self.querySelector('[data-sd-swap="count"]'));
          if (count) S.announce(count);
          if (!opts.popstate) self._trackFilters(url);
          self._remember();
          // En escritorio, devuelve la vista al inicio de los resultados si se había desplazado
          var top = self.results.getBoundingClientRect().top;
          if (!opts.popstate && top < 0) {
            self.results.scrollIntoView({ block: 'start', behavior: S.prefersReducedMotion() ? 'auto' : 'smooth' });
          }
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          // Alternativa fiable: navegación normal
          window.location.href = url;
        })
        .then(function () {
          self._busy(false);
        });
    }

    _trackFilters(url) {
      try {
        var u = new URL(url, location.origin);
        var keys = [];
        u.searchParams.forEach(function (v, k) {
          if (k.indexOf('filter.') === 0 && keys.indexOf(k) === -1) keys.push(k.replace(/^filter\.(p\.m\.)?/, ''));
        });
        if (!keys.length) return;
        var count = S.text(this.querySelector('[data-sd-swap="count"]'));
        var n = parseInt((count.match(/\d+/) || [''])[0], 10);
        S.track('filters_applied', { filter_keys: keys.join(','), results_count: isFinite(n) ? n : undefined });
      } catch (e) {}
    }

    /* ---------- Cargar más ---------- */
    _loadMore(btn, quiet) {
      var self = this;
      var next = btn.getAttribute('data-next-url');
      if (!next) return Promise.resolve();
      btn.setAttribute('aria-busy', 'true');
      btn.setAttribute('aria-disabled', 'true');
      return this._fetch(next)
        .then(function (text) {
          var doc = S.parseHTML(text);
          var grid = self.querySelector('[data-sd-grid]');
          var items = doc.querySelectorAll('[data-sd-grid] > li');
          var firstNew = null;
          Array.prototype.forEach.call(items, function (li) {
            var node = document.importNode(li, true);
            if (!firstNew) firstNew = node;
            grid.appendChild(node);
          });
          var pagNew = doc.querySelector('[data-sd-swap="pagination"]');
          var pagCur = self.querySelector('[data-sd-swap="pagination"]');
          if (pagNew && pagCur) pagCur.innerHTML = pagNew.innerHTML;
          self._pages += 1;
          self._remember();
          if (!quiet) {
            S.announce(S.t('facets.loaded_more', { count: items.length }));
            var focusTarget = firstNew && firstNew.querySelector('.sd-card__link');
            if (focusTarget) focusTarget.focus({ preventScroll: false });
          }
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          window.location.href = next;
        })
        .then(function () {
          btn.removeAttribute('aria-busy');
          btn.removeAttribute('aria-disabled');
        });
    }

    /* ---------- Posición al volver desde una ficha ---------- */
    _storeKey() {
      return 'sd:facets:' + location.pathname + location.search;
    }

    _remember() {
      var self = this;
      if (this._rememberBound) return;
      this._rememberBound = true;
      this._saveHandler = function (e) {
        if (e.type === 'click') {
          var a = e.target.closest && e.target.closest('a[href]');
          if (!a || !/\/products\//.test(a.getAttribute('href') || '')) return;
        }
        try {
          sessionStorage.setItem(self._storeKey(), JSON.stringify({ pages: self._pages, y: window.scrollY }));
        } catch (err) {}
      };
      this.addEventListener('click', this._saveHandler);
      window.addEventListener('pagehide', this._saveHandler);
    }

    _restore() {
      var self = this;
      var raw = null;
      try {
        raw = sessionStorage.getItem(this._storeKey());
      } catch (e) {}
      if (!raw) return;
      try {
        sessionStorage.removeItem(this._storeKey());
      } catch (e) {}
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return;
      }
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (!nav || nav.type !== 'back_forward') return;
      if (!data || !(data.pages > 1)) return;
      // Solo si estamos en la página 1 (no hay ?page= en la URL)
      if (new URLSearchParams(location.search).has('page')) return;

      var chain = Promise.resolve();
      var loadOne = function () {
        var btn = self.querySelector('[data-sd-load-more]');
        if (!btn) return Promise.resolve();
        return self._loadMore(btn, true);
      };
      for (var i = 1; i < data.pages; i++) chain = chain.then(loadOne);
      chain.then(function () {
        window.scrollTo(0, data.y || 0);
      });
    }
  }
  S.define('sd-facets', SdFacets);
})();
