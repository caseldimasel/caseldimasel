/* SIDONIA · directorio de marcas
 * <sd-brands> mejora el listado (que funciona sin JavaScript, con ambos paneles visibles):
 *  - pestañas Coches / Barcos (patrón WAI-ARIA tabs, flechas y Inicio/Fin),
 *  - buscador local de marcas,
 *  - resalta las marcas con piezas y su número, leyendo los filtros reales de la colección de cada división
 *    (no se inventan cifras: si no se puede leer, no se muestra nada).
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__brands) return;
  S.__brands = true;

  var TTL = 10 * 60 * 1000;

  function cacheGet(key) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return Date.now() - o.t < TTL ? o.v : null;
    } catch (e) {
      return null;
    }
  }
  function cacheSet(key, v) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v }));
    } catch (e) {}
  }

  /** Lee los valores y recuentos del filtro de marca de una colección (HTML renderizado por el servidor). */
  function readFacet(url, param) {
    var key = 'sd:brands:' + url + ':' + param;
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    return fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var doc = S.parseHTML(text);
        var out = {};
        Array.prototype.forEach.call(doc.querySelectorAll('input[type="checkbox"]'), function (inp) {
          if (inp.getAttribute('name') !== param) return;
          var label = inp.closest('label');
          var c = label && label.querySelector('.sd-count');
          var n = c ? parseInt((c.textContent.match(/\d+/) || ['0'])[0], 10) : 0;
          out[inp.value] = n;
        });
        cacheSet(key, out);
        return out;
      });
  }

  class SdBrands extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$tabs = this.querySelector('[data-sd-brand-tabs]');
      this.$panels = Array.prototype.slice.call(this.querySelectorAll('[data-sd-brand-panel]'));
      this.$search = this.querySelector('[data-sd-brand-search]');
      this.$stock = this.querySelector('[data-sd-brand-stock]');
      this.$stockWrap = this.querySelector('[data-sd-brand-stock-wrap]');
      this.$status = this.querySelector('[data-sd-brand-status]');
      this.$none = this.querySelector('[data-sd-brand-none]');
      this.active = 'cars';
      this.stock = {};
      var self = this;

      if (this.$tabs) {
        this.$tabs.hidden = false;
        this._onTab = function (e) {
          var t = e.target.closest('[data-sd-brand-tab]');
          if (t) self.select(t.getAttribute('data-sd-brand-tab'), true);
        };
        this._onKey = function (e) {
          var tabs = Array.prototype.slice.call(self.$tabs.querySelectorAll('[role="tab"]'));
          var i = tabs.indexOf(document.activeElement);
          if (i < 0) return;
          var next = null;
          if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
          else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (e.key === 'Home') next = tabs[0];
          else if (e.key === 'End') next = tabs[tabs.length - 1];
          if (next) {
            e.preventDefault();
            self.select(next.getAttribute('data-sd-brand-tab'), true);
          }
        };
        this.$tabs.addEventListener('click', this._onTab);
        this.$tabs.addEventListener('keydown', this._onKey);
        var hash = (location.hash || '').replace('#', '');
        this.select(hash === 'boats' ? 'boats' : 'cars', false);
      }

      if (this.$search) {
        this.$search.hidden = false;
        this._onSearch = S.debounce(this.filter.bind(this), 120);
        this.$search.addEventListener('input', this._onSearch);
      }
      if (this.$stock) {
        this._onStock = this.filter.bind(this);
        this.$stock.addEventListener('change', this._onStock);
      }
      this.loadStock();
    }

    disconnectedCallback() {
      this._bound = false;
      if (this.$tabs) {
        this.$tabs.removeEventListener('click', this._onTab);
        this.$tabs.removeEventListener('keydown', this._onKey);
      }
      if (this.$search) this.$search.removeEventListener('input', this._onSearch);
      if (this.$stock) this.$stock.removeEventListener('change', this._onStock);
    }

    select(kind, focus) {
      this.active = kind;
      var self = this;
      Array.prototype.forEach.call(this.$tabs.querySelectorAll('[role="tab"]'), function (t) {
        var on = t.getAttribute('data-sd-brand-tab') === kind;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      this.$panels.forEach(function (p) {
        p.hidden = p.getAttribute('data-sd-brand-panel') !== kind;
      });
      void self;
      this.filter();
    }

    filter() {
      var q = this.$search ? this.$search.value.trim().toLowerCase() : '';
      var onlyStock = !!(this.$stock && this.$stock.checked);
      var shown = 0;
      this.$panels.forEach(function (panel) {
        if (panel.hidden) return;
        Array.prototype.forEach.call(panel.querySelectorAll('.sd-brandgroup'), function (g) {
          var any = 0;
          Array.prototype.forEach.call(g.querySelectorAll('li'), function (li) {
            var a = li.querySelector('.sd-brand');
            var name = (a.getAttribute('data-brand') || '').toLowerCase();
            var ok = (!q || name.indexOf(q) > -1) && (!onlyStock || a.classList.contains('has-stock'));
            li.hidden = !ok;
            if (ok) any++;
          });
          g.hidden = any === 0;
          shown += any;
        });
        if (panel.querySelector('.sd-brandlist--flat')) {
          Array.prototype.forEach.call(panel.querySelectorAll('.sd-brandlist--flat li'), function (li) {
            var a = li.querySelector('.sd-brand');
            li.hidden = onlyStock && !a.classList.contains('has-stock');
            if (!li.hidden) shown++;
          });
        }
      });
      if (this.$none) this.$none.hidden = shown > 0;
      if (q || onlyStock) S.announce(shown ? S.t('brands.found', { count: shown }) : S.t('brands.none'));
    }

    loadStock() {
      var self = this;
      var jobs = this.$panels.map(function (panel) {
        var kind = panel.getAttribute('data-sd-brand-panel');
        var url = kind === 'cars' ? self.dataset.garageUrl : self.dataset.harborUrl;
        var param = panel.getAttribute('data-param');
        if (!url) return Promise.resolve();
        return readFacet(url, param)
          .then(function (facet) {
            var total = 0;
            Array.prototype.forEach.call(panel.querySelectorAll('.sd-brand'), function (a) {
              var n = facet[a.getAttribute('data-brand')];
              if (n > 0) {
                a.classList.add('has-stock');
                var c = a.querySelector('.sd-brand__count');
                c.textContent = String(n);
                c.hidden = false;
                a.setAttribute('aria-label', S.t('brands.with_count', { brand: a.getAttribute('data-brand'), count: n }));
                total++;
              }
            });
            if (total && self.$stockWrap) self.$stockWrap.hidden = false;
          })
          .catch(function () {
            /* sin datos de existencias: el listado sigue siendo útil */
          });
      });
      Promise.all(jobs).then(function () {
        self.filter();
      });
    }
  }
  S.define('sd-brands', SdBrands);
})();
