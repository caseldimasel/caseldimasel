/* SIDONIA · catálogo: filtros, orden, vista y «Cargar más»
 *
 * Mejora progresiva sobre filtros que ya funcionan sin JavaScript (formulario GET + paginación real).
 *  - Cada cambio consulta a Shopify (filtros de Storefront / Search & Discovery) mediante la
 *    Section Rendering API: se filtra TODO el catálogo, nunca solo las tarjetas visibles.
 *  - El estado vive en la URL: recargar, compartir, atrás y adelante funcionan.
 *  - Si algo falla, se navega a la URL normal (el servidor siempre tiene la respuesta correcta).
 *  - Escritorio: píldoras con paneles (uno abierto a la vez, Escape y clic fuera cierran).
 *    Móvil: panel modal con «Ver N resultados».
 *  - «Cargar más» usa la URL «siguiente» de la paginación real y se restaura al volver de una ficha.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__catalog) return;
  S.__catalog = true;

  var SWAPS = ['badge', 'count', 'filters', 'apply', 'active', 'grid', 'pagination'];
  var VIEW_KEY = 'sidonia:view';

  function desktop() {
    return !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
  }

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch (e) {
      return 'grid';
    }
  }

  class SidoniaFacets extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.sectionId = this.dataset.sectionId;
      this.form = this.querySelector('[data-sidonia-facets-form]');
      this.dialog = this.querySelector('[data-sidonia-filters]');
      this.results = this.querySelector('[data-sidonia-results]');
      if (!this.form || !this.results) return;
      this._pages = 1;
      this._abort = null;

      if (this.dialog && this.dialog.open) this.dialog.close();

      this._onChange = S.debounce(this._apply.bind(this), 260);
      this.form.addEventListener('change', this._onChange);
      this._onSubmit = function (e) {
        e.preventDefault();
        this._apply();
      }.bind(this);
      this.form.addEventListener('submit', this._onSubmit);
      this._onClick = this._click.bind(this);
      this.addEventListener('click', this._onClick);
      this._onToggle = this._groupToggled.bind(this);
      this.addEventListener('toggle', this._onToggle, true);
      this._onDocClick = this._outside.bind(this);
      document.addEventListener('click', this._onDocClick);
      this._onKey = this._key.bind(this);
      this.addEventListener('keydown', this._onKey);
      this._onPop = function (e) {
        if (e.state && e.state.sidonia === 'facets') this._load(location.href, { popstate: true });
      }.bind(this);
      window.addEventListener('popstate', this._onPop);
      history.replaceState(Object.assign({}, history.state || {}, { sidonia: 'facets' }), '');

      this._setupView();
      this._setupLoadMore();
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
      this.removeEventListener('toggle', this._onToggle, true);
      this.removeEventListener('keydown', this._onKey);
      document.removeEventListener('click', this._onDocClick);
      window.removeEventListener('popstate', this._onPop);
      if (this._saveHandler) {
        this.removeEventListener('click', this._saveHandler);
        window.removeEventListener('pagehide', this._saveHandler);
      }
      if (this._abort) this._abort.abort();
    }

    /* ---------- panel móvil y paneles de escritorio ---------- */
    _openFilters() {
      if (!this.dialog) return;
      this._opener = this.querySelector('[data-sidonia-open-filters]');
      S.openDialog(this.dialog);
      var first = this.dialog.querySelector('summary, input, button');
      if (first) first.focus();
    }

    _closeFilters() {
      if (!this.dialog) return;
      S.closeDialog(this.dialog);
      if (this._opener) this._opener.focus();
    }

    _groupToggled(e) {
      var d = e.target;
      if (!d || !d.matches || !d.matches('[data-sidonia-fgroup]') || !d.open || !desktop()) return;
      Array.prototype.forEach.call(this.querySelectorAll('[data-sidonia-fgroup][open]'), function (o) {
        if (o !== d) o.open = false;
      });
    }

    _outside(e) {
      if (!desktop()) return;
      var openGroups = this.querySelectorAll('[data-sidonia-fgroup][open]');
      Array.prototype.forEach.call(openGroups, function (g) {
        if (!g.contains(e.target)) g.open = false;
      });
    }

    _key(e) {
      if (e.key !== 'Escape' || !desktop()) return;
      var g = e.target.closest && e.target.closest('[data-sidonia-fgroup][open]');
      if (!g) return;
      g.open = false;
      var sum = g.querySelector('summary');
      if (sum) sum.focus();
    }

    _click(e) {
      if (e.target.closest('[data-sidonia-open-filters]')) {
        e.preventDefault();
        return this._openFilters();
      }
      if (e.target.closest('[data-sidonia-close-filters]')) {
        e.preventDefault();
        return this._closeFilters();
      }
      var more = e.target.closest('[data-sidonia-load-more]');
      if (more) {
        e.preventDefault();
        return this._loadMore(more);
      }
      var view = e.target.closest('[data-sidonia-view] [data-view]');
      if (view) {
        e.preventDefault();
        return this._setView(view.getAttribute('data-view'), true);
      }
      var link = e.target.closest('a[data-sidonia-facet-link]');
      if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
        e.preventDefault();
        this._load(link.href, {});
      }
    }

    /* ---------- consultas ---------- */
    _buildUrl() {
      var url = new URL(this.form.getAttribute('action') || location.pathname, location.origin);
      new FormData(this.form).forEach(function (value, key) {
        if (typeof value !== 'string' || value === '' || key === 'page') return;
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
      if (on) S.announce(S.t('loading'));
    }

    _swap(doc) {
      var self = this;
      var open = {};
      Array.prototype.forEach.call(this.querySelectorAll('[data-sidonia-fgroup]'), function (d) {
        open[d.getAttribute('data-param')] = d.open;
      });
      var a = document.activeElement;
      var snap = a && this.contains(a) && a.name ? { name: a.name, value: a.value } : null;

      SWAPS.forEach(function (key) {
        var cur = self.querySelector('[data-sidonia-swap="' + key + '"]');
        var nxt = doc.querySelector('[data-sidonia-swap="' + key + '"]');
        if (cur && nxt) cur.innerHTML = nxt.innerHTML;
      });
      var sortNew = doc.querySelector('[data-sidonia-sort]');
      var sortCur = this.querySelector('[data-sidonia-sort]');
      if (sortNew && sortCur) sortCur.value = sortNew.value;
      Array.prototype.forEach.call(this.querySelectorAll('[data-sidonia-fgroup]'), function (d) {
        var k = d.getAttribute('data-param');
        if (Object.prototype.hasOwnProperty.call(open, k)) d.open = open[k];
      });
      if (snap) {
        var sel = '[name="' + (window.CSS && CSS.escape ? CSS.escape(snap.name) : snap.name) + '"]';
        var cands = this.querySelectorAll(sel);
        for (var i = 0; i < cands.length; i++) {
          if (cands[i].type === 'checkbox' && cands[i].value !== snap.value) continue;
          if (!cands[i].disabled) {
            cands[i].focus({ preventScroll: true });
            break;
          }
        }
      }
      this._setView(readView(), false);
      this._setupLoadMore();
    }

    _load(url, opts) {
      var self = this;
      this._busy(true);
      return this._fetch(url)
        .then(function (text) {
          self._swap(S.parseHTML(text));
          self._pages = 1;
          if (!opts.popstate) history.pushState({ sidonia: 'facets' }, '', url);
          var count = self.querySelector('[data-sidonia-swap="count"]');
          if (count) S.announce(count.textContent.trim());
          if (!opts.popstate) self._track(url);
          var top = self.results.getBoundingClientRect().top;
          if (!opts.popstate && top < 0 && !(self.dialog && self.dialog.open && !desktop())) {
            self.results.scrollIntoView({ block: 'start', behavior: S.prefersReducedMotion() ? 'auto' : 'smooth' });
          }
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          window.location.href = url;
        })
        .then(function () {
          self.results.setAttribute('aria-busy', 'false');
        });
    }

    _track(url) {
      try {
        var u = new URL(url, location.origin);
        var keys = [];
        u.searchParams.forEach(function (v, k) {
          if (k.indexOf('filter.') !== 0) return;
          var short = k.replace(/^filter\.(p\.m\.sidonia\.|p\.m\.|v\.|p\.)?/, '');
          if (keys.indexOf(short) === -1) keys.push(short);
        });
        var countEl = this.querySelector('[data-sidonia-swap="count"]');
        var n = countEl ? parseInt((countEl.textContent.replace(/\./g, '').match(/\d+/) || [''])[0], 10) : NaN;
        S.track('filters_applied', { filters: keys.join(','), count: isFinite(n) ? n : undefined, sort: u.searchParams.get('sort_by') || '' });
      } catch (e) {}
    }

    /* ---------- vista cuadrícula / lista (preferencia de este navegador) ---------- */
    _setupView() {
      var box = this.querySelector('[data-sidonia-view]');
      if (box) box.hidden = false;
      this._setView(readView(), false);
    }

    _setView(view, save) {
      var grid = this.querySelector('[data-sidonia-grid]');
      if (grid) grid.classList.toggle('sidonia-grid--list', view === 'list');
      Array.prototype.forEach.call(this.querySelectorAll('[data-sidonia-view] [data-view]'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
      });
      if (save) {
        try {
          localStorage.setItem(VIEW_KEY, view);
        } catch (e) {}
      }
    }

    /* ---------- Cargar más ---------- */
    _setupLoadMore() {
      if (this.dataset.loadMore !== 'true') return;
      var box = this.querySelector('[data-sidonia-loadmore]');
      if (box) {
        box.hidden = false;
        var pag = box.closest('[data-sidonia-pagination]');
        if (pag) pag.classList.add('has-loadmore');
      }
    }

    _loadMore(btn, quiet) {
      var self = this;
      var next = btn.getAttribute('data-next-url');
      if (!next) return Promise.resolve();
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      return this._fetch(next)
        .then(function (text) {
          var doc = S.parseHTML(text);
          var grid = self.querySelector('[data-sidonia-grid]');
          var items = doc.querySelectorAll('[data-sidonia-grid] > li');
          var firstNew = null;
          Array.prototype.forEach.call(items, function (li) {
            var node = document.importNode(li, true);
            if (!firstNew) firstNew = node;
            grid.appendChild(node);
          });
          var pagNew = doc.querySelector('[data-sidonia-swap="pagination"]');
          var pagCur = self.querySelector('[data-sidonia-swap="pagination"]');
          if (pagNew && pagCur) pagCur.innerHTML = pagNew.innerHTML;
          self._setupLoadMore();
          self._pages += 1;
          if (!quiet) {
            S.announce(S.t('loadedMore', { count: items.length }));
            var link = firstNew && firstNew.querySelector('.sidonia-card__link');
            if (link) link.focus();
          }
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          window.location.href = next;
        })
        .then(function () {
          btn.removeAttribute('aria-busy');
          btn.disabled = false;
        });
    }

    /* ---------- posición al volver desde una ficha ---------- */
    _storeKey() {
      return 'sidonia:catalog:' + location.pathname + location.search;
    }

    _remember() {
      var self = this;
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
        sessionStorage.removeItem(this._storeKey());
      } catch (e) {}
      if (!raw) return;
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return;
      }
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (!nav || nav.type !== 'back_forward' || !data) return;
      if (!(data.pages > 1) || new URLSearchParams(location.search).has('page')) {
        if (data.y) window.scrollTo(0, data.y);
        return;
      }
      var chain = Promise.resolve();
      function loadOne() {
        var btn = self.querySelector('[data-sidonia-load-more]');
        return btn ? self._loadMore(btn, true) : Promise.resolve();
      }
      for (var i = 1; i < data.pages; i++) chain = chain.then(loadOne);
      chain.then(function () {
        window.scrollTo(0, data.y || 0);
      });
    }
  }
  S.define('sidonia-facets', SidoniaFacets);
})();
