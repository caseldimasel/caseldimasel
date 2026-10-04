/* SIDONIA · favoritos anónimos (solo en este navegador)
 *
 * - Guarda lo mínimo: id de producto, handle, título corto y fecha. Nada personal.
 * - localStorage → sessionStorage → memoria, con aviso honesto si no se puede persistir.
 * - Contenido corrupto o de otra versión: se descarta o migra sin romper la página.
 * - La página de Favoritos NO confía en lo guardado para precios o estado: consulta cada pieza
 *   con la plantilla alternativa /products/<handle>?view=card (vía documentada de Shopify).
 * - Elementos: <sd-save>, <sd-fav-count>, <sd-favorites-page>.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__favorites) return;
  S.__favorites = true;

  var KEY = 'sidonia:favorites:v1';
  var VERSION = 1;
  var MAX_ITEMS = 100;

  var memory = null; // último recurso
  var mode = 'local'; // local | session | memory
  var corrupt = false;
  var items = [];

  function probe(storage) {
    try {
      var k = '__sd_probe__';
      storage.setItem(k, '1');
      storage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function pickStorage() {
    try {
      if (probe(window.localStorage)) return window.localStorage;
    } catch (e) {}
    try {
      if (probe(window.sessionStorage)) return window.sessionStorage;
    } catch (e) {}
    return null;
  }

  var storage = pickStorage();
  try {
    mode = storage === window.localStorage ? 'local' : storage ? 'session' : 'memory';
  } catch (e) {
    mode = 'memory';
  }

  function validItem(it) {
    return (
      it &&
      (typeof it.id === 'string' || typeof it.id === 'number') &&
      String(it.id).length > 0 &&
      typeof it.handle === 'string' &&
      it.handle.length > 0 &&
      it.handle.length < 255
    );
  }

  function normalize(it) {
    return {
      id: String(it.id),
      handle: String(it.handle),
      title: typeof it.title === 'string' ? it.title.slice(0, 120) : '',
      t: typeof it.t === 'number' ? it.t : Date.now()
    };
  }

  /** Acepta la versión actual y migra formatos anteriores (lista simple de handles). */
  function parse(raw) {
    if (!raw) return [];
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      corrupt = true;
      return [];
    }
    if (Array.isArray(data)) {
      // formato v0: lista de handles
      return data
        .filter(function (h) {
          return typeof h === 'string' && h;
        })
        .map(function (h) {
          return normalize({ id: 'h:' + h, handle: h });
        });
    }
    if (data && typeof data === 'object' && data.v === VERSION && Array.isArray(data.items)) {
      return data.items.filter(validItem).map(normalize).slice(0, MAX_ITEMS);
    }
    if (data && typeof data === 'object' && data.v > VERSION) {
      // creado por una versión futura: no lo tocamos, trabajamos en memoria
      corrupt = true;
      return [];
    }
    corrupt = true;
    return [];
  }

  function load() {
    corrupt = false;
    if (storage) {
      try {
        items = parse(storage.getItem(KEY));
        if (corrupt) storage.removeItem(KEY);
        return;
      } catch (e) {
        storage = null;
        mode = 'memory';
      }
    }
    items = memory ? memory.slice() : [];
  }

  function persist() {
    memory = items.slice();
    if (!storage) return false;
    try {
      storage.setItem(KEY, JSON.stringify({ v: VERSION, items: items }));
      return true;
    } catch (e) {
      storage = null;
      mode = 'memory';
      return false;
    }
  }

  var store = {
    get items() {
      return items.slice();
    },
    get mode() {
      return mode;
    },
    get persistent() {
      return mode === 'local';
    },
    get wasCorrupt() {
      return corrupt;
    },
    count: function () {
      return items.length;
    },
    has: function (id) {
      var sid = String(id);
      return items.some(function (i) {
        return i.id === sid;
      });
    },
    add: function (it) {
      if (!validItem(it) || this.has(it.id)) return false;
      if (items.length >= MAX_ITEMS) items.pop();
      items.unshift(normalize(it));
      persist();
      this._changed();
      return true;
    },
    remove: function (id) {
      var sid = String(id);
      var before = items.length;
      items = items.filter(function (i) {
        return i.id !== sid;
      });
      if (items.length === before) return false;
      persist();
      this._changed();
      return true;
    },
    clear: function () {
      items = [];
      persist();
      this._changed();
    },
    updateHandle: function (id, handle) {
      var sid = String(id);
      var changed = false;
      items.forEach(function (i) {
        if (i.id === sid && i.handle !== handle) {
          i.handle = handle;
          changed = true;
        }
      });
      if (changed) persist();
    },
    _changed: function () {
      S.emit('sd:favorites:change', { count: items.length });
    }
  };

  load();
  S.favorites = store;

  // Sincronización entre pestañas
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    load();
    store._changed();
  });

  function storageMessage() {
    if (mode === 'local') return '';
    if (mode === 'session') return S.t('favorites.warn_session');
    return S.t('favorites.warn_memory');
  }
  S.favorites.storageMessage = storageMessage;

  /* ---------------- <sd-save> ---------------- */
  class SdSave extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.hidden = false;
      this._btn = this.querySelector('[data-sd-save-btn]');
      this._label = this.querySelector('[data-sd-save-label]');
      this._onClick = this._toggle.bind(this);
      this._onChange = this._sync.bind(this);
      if (this._btn) this._btn.addEventListener('click', this._onClick);
      document.addEventListener('sd:favorites:change', this._onChange);
      this._sync();
    }
    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      if (this._btn) this._btn.removeEventListener('click', this._onClick);
      document.removeEventListener('sd:favorites:change', this._onChange);
    }
    _info() {
      return { id: this.dataset.id, handle: this.dataset.handle, title: this.dataset.title || '' };
    }
    _toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      var info = this._info();
      if (!info.id || !info.handle) return;
      var title = info.title || info.handle;
      if (store.has(info.id)) {
        store.remove(info.id);
        S.announce(S.t('favorites.removed_announce', { title: title }));
        S.track('favorite_remove', { category: this._category() });
      } else {
        store.add(info);
        S.announce(S.t('favorites.added_announce', { title: title }));
        S.track('favorite_add', { category: this._category() });
        if (!store.persistent && !S.__favWarned) {
          S.__favWarned = true;
          S.toast(storageMessage());
        }
      }
    }
    _category() {
      var host = this.closest('[data-category]');
      if (host) return host.getAttribute('data-category') || '';
      var card = this.closest('.sd-card');
      if (!card) return '';
      var m = /sd-cat--(\w+)/.exec(card.className);
      return m ? m[1] : '';
    }
    _sync() {
      var id = this.dataset.id;
      var on = !!id && store.has(id);
      if (this._btn) this._btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (this._label) this._label.textContent = on ? S.t('favorites.saved') : S.t('favorites.save');
    }
  }
  S.define('sd-save', SdSave);

  /* ---------------- <sd-fav-count> ---------------- */
  class SdFavCount extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._onChange = this._sync.bind(this);
      document.addEventListener('sd:favorites:change', this._onChange);
      this._sync();
    }
    disconnectedCallback() {
      this._bound = false;
      document.removeEventListener('sd:favorites:change', this._onChange);
    }
    _sync() {
      var n = store.count();
      this.textContent = n > 99 ? '99+' : String(n);
      this.hidden = n === 0;
      this.setAttribute('aria-hidden', 'true');
      var link = this.closest('[data-sd-fav-link]');
      var label = link && link.querySelector('[data-sd-fav-label]');
      if (label) {
        label.textContent = n > 0 ? S.t('favorites.link_count', { count: n }) : S.t('favorites.link_empty');
      }
    }
  }
  S.define('sd-fav-count', SdFavCount);

  /* ---------------- <sd-favorites-page> ---------------- */
  class SdFavoritesPage extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$grid = this.querySelector('[data-sd-fav-grid]');
      this.$empty = this.querySelector('[data-sd-fav-empty]');
      this.$bar = this.querySelector('[data-sd-fav-bar]');
      this.$count = this.querySelector('[data-sd-fav-count-text]');
      this.$loading = this.querySelector('[data-sd-fav-loading]');
      this.$warn = this.querySelector('[data-sd-fav-warning]');
      this.$warnText = this.querySelector('[data-sd-fav-warning-text]');
      this.$confirm = this.querySelector('[data-sd-fav-confirm]');
      this.$removedTpl = this.querySelector('template[data-sd-fav-removed]');
      this._cards = Object.create(null); // id -> <li>
      this._abort = null;

      this._onChange = this._onStoreChange.bind(this);
      document.addEventListener('sd:favorites:change', this._onChange);

      this._onClear = this._askClear.bind(this);
      var clear = this.querySelector('[data-sd-fav-clear]');
      if (clear) clear.addEventListener('click', this._onClear);
      this._clearBtn = clear;

      if (this.$confirm) {
        this._onConfirmClose = function () {
          if (this.$confirm.returnValue === 'confirm') store.clear();
          this.$confirm.returnValue = '';
        }.bind(this);
        this.$confirm.addEventListener('close', this._onConfirmClose);
      }

      this._onGridClick = function (e) {
        var btn = e.target.closest && e.target.closest('[data-sd-fav-remove]');
        if (!btn) return;
        var li = btn.closest('li');
        if (li && li.dataset.id) store.remove(li.dataset.id);
      };
      this.$grid.addEventListener('click', this._onGridClick);

      this._showWarnings();
      this.render();
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      document.removeEventListener('sd:favorites:change', this._onChange);
      if (this._clearBtn) this._clearBtn.removeEventListener('click', this._onClear);
      if (this.$confirm && this._onConfirmClose) this.$confirm.removeEventListener('close', this._onConfirmClose);
      if (this.$grid) this.$grid.removeEventListener('click', this._onGridClick);
      if (this._abort) this._abort.abort();
    }

    _showWarnings() {
      var msg = '';
      if (store.wasCorrupt) msg = S.t('favorites.warn_corrupt');
      else if (!store.persistent) msg = store.storageMessage();
      if (this.$warn) {
        this.$warn.hidden = !msg;
        if (this.$warnText) this.$warnText.textContent = msg;
      }
    }

    _askClear() {
      if (!store.count()) return;
      if (this.$confirm && typeof this.$confirm.showModal === 'function') {
        this.$confirm.showModal();
      } else if (window.confirm(S.t('favorites.confirm_title'))) {
        store.clear();
      }
    }

    _updateChrome() {
      var n = store.count();
      if (this.$empty) this.$empty.hidden = n > 0;
      if (this.$bar) this.$bar.hidden = n === 0;
      if (this.$count) this.$count.textContent = S.t(n === 1 ? 'favorites.count_one' : 'favorites.count_other', { count: n });
      if (this.$loading && n === 0) this.$loading.hidden = true;
    }

    _onStoreChange() {
      // Quita lo que ya no está guardado; no vuelve a pedir lo que ya se muestra.
      var ids = store.items.map(function (i) {
        return i.id;
      });
      var self = this;
      Object.keys(this._cards).forEach(function (id) {
        if (ids.indexOf(id) === -1) {
          var li = self._cards[id];
          if (li && li.parentNode) li.parentNode.removeChild(li);
          delete self._cards[id];
        }
      });
      // Si llegan ids nuevos (otra pestaña), se vuelve a pintar entera.
      var missing = ids.some(function (id) {
        return !self._cards[id];
      });
      if (missing) this.render();
      else this._updateChrome();
    }

    /** Consulta el estado ACTUAL de cada pieza. */
    render() {
      var self = this;
      var list = store.items;
      this._updateChrome();
      if (this._abort) this._abort.abort();
      this._abort = typeof AbortController === 'function' ? new AbortController() : null;
      this.$grid.innerHTML = '';
      this._cards = Object.create(null);
      if (!list.length) return;

      if (this.$loading) this.$loading.hidden = false;
      var queue = list.slice();
      var results = {};
      var running = 0;
      var done = 0;
      var failed = 0;
      var suffix = this.dataset.cardUrlSuffix || 'view=card';

      function finish() {
        if (self.$loading) self.$loading.hidden = true;
        // Pintar en el orden guardado
        list.forEach(function (it) {
          var li = results[it.id];
          if (!li) return;
          self.$grid.appendChild(li);
          self._cards[it.id] = li;
        });
        self._updateChrome();
        if (failed) {
          if (self.$warn) {
            self.$warn.hidden = false;
            if (self.$warnText) self.$warnText.textContent = S.t('favorites.warn_fetch');
          }
        }
      }

      function next() {
        while (running < 4 && queue.length) {
          running++;
          (function (it) {
            fetchCard(it, suffix, self._abort ? self._abort.signal : undefined)
              .then(function (li) {
                results[it.id] = li;
              })
              .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                failed++;
                results[it.id] = self._removedTile(it, err && err.status === 404);
              })
              .then(function () {
                running--;
                done++;
                if (done === list.length) finish();
                else next();
              });
          })(queue.shift());
        }
      }
      next();
    }

    _removedTile(item) {
      var li;
      if (this.$removedTpl) {
        li = this.$removedTpl.content.firstElementChild.cloneNode(true);
        var t = li.querySelector('[data-sd-fav-removed-title]');
        if (t) t.textContent = item.title || item.handle;
      } else {
        li = document.createElement('li');
        li.textContent = item.title || item.handle;
      }
      li.dataset.id = item.id;
      return li;
    }
  }
  S.define('sd-favorites-page', SdFavoritesPage);

  function fetchCard(item, suffix, signal) {
    var url = '/products/' + encodeURIComponent(item.handle) + '?' + suffix;
    return fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin', cache: 'no-cache', signal: signal }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      // Si el handle cambió y Shopify redirigió, actualizamos lo guardado.
      try {
        var path = new URL(res.url).pathname;
        var m = /\/products\/([^/]+)/.exec(path);
        if (m && decodeURIComponent(m[1]) !== item.handle) store.updateHandle(item.id, decodeURIComponent(m[1]));
      } catch (e) {}
      return res.text().then(function (text) {
        var doc = S.parseHTML(text);
        var card = doc.querySelector('.sd-card');
        if (!card) {
          var err = new Error('sin tarjeta');
          err.status = 404;
          throw err;
        }
        var pid = card.getAttribute('data-product-id');
        // Los ids antiguos (formato v0) se completan con el real.
        var li = document.createElement('li');
        li.dataset.id = pid && item.id.indexOf('h:') === 0 ? pid : item.id;
        li.appendChild(document.importNode(card, true));
        return li;
      });
    });
  }
})();
