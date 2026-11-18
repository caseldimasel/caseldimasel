/* SIDONIA · núcleo del kit para Impact
 *
 * Sin dependencias ni paso de build. Todo es idempotente: el editor de temas carga y descarga
 * secciones, y cada custom element se enlaza al conectarse y se limpia al desconectarse.
 *
 * Contenido:
 *   1. Utilidades (configuración, traducciones, avisos, diálogos)
 *   2. Analítica opcional (desacoplada, con consentimiento, sin datos personales)
 *   3. Favoritos anónimos: <sidonia-save>, <sidonia-fav-count>, <sidonia-favorites-page>
 *   4. Compartir: <sidonia-share>
 *   5. Búsqueda del hero (categoría + texto)
 *   6. Clip de fondo del hero: <sidonia-autopreview>
 *   7. Estado de cabecera transparente → sólida (contrato data-sidonia-header-overlay)
 */
(function () {
  'use strict';
  if (window.Sidonia && window.Sidonia.__core) return;
  var S = (window.Sidonia = window.Sidonia || {});
  S.__core = true;
  document.documentElement.classList.add('sidonia-js');

  /* ------------------------------------------------------------------ 1. utilidades */

  function readConfig() {
    try {
      var el = document.getElementById('sidonia-config');
      return el ? JSON.parse(el.textContent) : {};
    } catch (e) {
      return {};
    }
  }
  S.config = readConfig();

  /** Cadena traducida (locales → #sidonia-config). Marcadores simples: {nombre}. */
  S.t = function (key, vars) {
    var strings = (S.config && S.config.strings) || {};
    var out = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        out = out.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return out;
  };

  S.define = function (name, ctor) {
    if (!window.customElements || window.customElements.get(name)) return;
    window.customElements.define(name, ctor);
  };

  S.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  };

  S.debounce = function (fn, wait) {
    var timer;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  };

  var liveTimer;
  /** Un único aviso «polite» para lectores de pantalla, sin acumular mensajes. */
  S.announce = function (message) {
    var live = document.getElementById('sidonia-live');
    if (!live || !message) return;
    clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = setTimeout(function () {
      live.textContent = message;
    }, 80);
  };

  /** Aviso visual breve (decorativo: el anuncio accesible va por S.announce). */
  S.toast = function (message) {
    if (!message) return;
    var old = document.querySelector('.sidonia-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'sidonia-toast';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3200);
  };

  S.prefersReducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  /** Ahorro de datos o conexión lenta, cuando el navegador lo expone (no todos lo hacen). */
  S.saveData = function () {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /(^|-)(2g|3g)$/.test(c.effectiveType || '');
  };

  S.parseHTML = function (text) {
    return new DOMParser().parseFromString(text, 'text/html');
  };

  /** Solo http(s) o rutas relativas en URLs que llegan por atributos data-*. */
  S.safeUrl = function (value) {
    if (!value) return '';
    try {
      var u = new URL(value, location.href);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) {
      return '';
    }
  };

  function anyModalOpen() {
    try {
      return !!document.querySelector('dialog:modal');
    } catch (e) {
      return false;
    }
  }

  S.openDialog = function (dialog) {
    if (!dialog) return;
    if (dialog.open && dialog.matches && (function () { try { return dialog.matches(':modal'); } catch (e) { return false; } })()) return;
    if (dialog.open) dialog.close();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.documentElement.classList.add('sidonia-lock');
  };

  S.closeDialog = function (dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
    if (!anyModalOpen()) document.documentElement.classList.remove('sidonia-lock');
  };

  document.addEventListener(
    'close',
    function (e) {
      if (e.target && e.target.tagName === 'DIALOG' && !anyModalOpen()) {
        document.documentElement.classList.remove('sidonia-lock');
      }
    },
    true
  );

  /* ------------------------------------------------------------------ 2. analítica */
  /*
   * Adaptador opcional y desacoplado. Desactivado por defecto (Ajustes del tema > Sidonia · Analítica).
   * - Respeta el consentimiento de Shopify (Customer Privacy API) antes de enviar nada.
   * - Solo admite parámetros de una lista cerrada: nunca mensajes, correos, teléfonos ni texto buscado.
   * - Destinos: Shopify.analytics.publish (eventos personalizados para píxeles) y window.dataLayer.
   * - Un clic en WhatsApp o correo NO es un lead recibido: se registra como «clic».
   */
  var ALLOWED = ['category', 'ref', 'status', 'video_kind', 'milestone', 'filters', 'count', 'form', 'sort', 'page', 'source'];
  var fired = {};

  function analyticsAllowed() {
    var a = S.config.analytics || {};
    if (!a.enabled) return false;
    if (!a.requireConsent) return true;
    try {
      var cp = window.Shopify && window.Shopify.customerPrivacy;
      if (cp && typeof cp.analyticsProcessingAllowed === 'function') return !!cp.analyticsProcessingAllowed();
    } catch (e) {}
    return false;
  }

  S.track = function (name, params, onceKey) {
    if (!name || !analyticsAllowed()) return;
    if (onceKey) {
      if (fired[onceKey]) return;
      fired[onceKey] = true;
    }
    var clean = {};
    Object.keys(params || {}).forEach(function (k) {
      if (ALLOWED.indexOf(k) === -1) return;
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      clean[k] = typeof v === 'number' ? v : String(v).slice(0, 80);
    });
    var event = 'sidonia_' + name;
    try {
      if (window.Shopify && window.Shopify.analytics && typeof window.Shopify.analytics.publish === 'function') {
        window.Shopify.analytics.publish(event, clean);
      }
    } catch (e) {}
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: event }, clean));
    } catch (e) {}
  };

  if (!S.__trackBound) {
    S.__trackBound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-sidonia-track]');
      if (!el) return;
      S.track(el.getAttribute('data-sidonia-track'), {
        category: el.getAttribute('data-sidonia-track-category') || '',
        ref: el.getAttribute('data-sidonia-track-ref') || ''
      });
    });
  }

  /* ------------------------------------------------------------------ 3. favoritos */
  /*
   * Guardado anónimo en ESTE navegador. Se guarda lo mínimo (id, handle, título corto, fecha).
   * localStorage → sessionStorage → memoria, con aviso honesto si no se puede conservar.
   * Contenido corrupto o de otra versión: se descarta sin romper la página.
   * El estado se sincroniza entre componentes y entre pestañas.
   */
  var KEY = 'sidonia:favorites:v1';
  var VERSION = 1;
  var MAX_ITEMS = 100;
  var memory = [];
  var corrupt = false;
  var items = [];

  function probe(storage) {
    try {
      var k = '__sidonia_probe__';
      storage.setItem(k, '1');
      storage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var storage = null;
  var mode = 'memory';
  try {
    if (probe(window.localStorage)) {
      storage = window.localStorage;
      mode = 'local';
    } else if (probe(window.sessionStorage)) {
      storage = window.sessionStorage;
      mode = 'session';
    }
  } catch (e) {
    storage = null;
    mode = 'memory';
  }

  function validItem(it) {
    return it && (typeof it.id === 'string' || typeof it.id === 'number') && String(it.id).length > 0 && typeof it.handle === 'string' && it.handle.length > 0 && it.handle.length < 255;
  }

  function normalize(it) {
    return {
      id: String(it.id),
      handle: String(it.handle),
      title: typeof it.title === 'string' ? it.title.slice(0, 120) : '',
      t: typeof it.t === 'number' ? it.t : Date.now()
    };
  }

  function parse(raw) {
    if (!raw) return [];
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      corrupt = true;
      return [];
    }
    if (data && typeof data === 'object' && data.v === VERSION && Array.isArray(data.items)) {
      return data.items.filter(validItem).map(normalize).slice(0, MAX_ITEMS);
    }
    corrupt = true;
    return [];
  }

  function load() {
    corrupt = false;
    if (storage) {
      try {
        var raw = storage.getItem(KEY);
        items = parse(raw);
        if (corrupt) {
          // Versión futura u objeto ajeno: no se sobrescribe a ciegas, se trabaja en memoria.
          var future = false;
          try {
            var d = JSON.parse(raw);
            future = d && typeof d.v === 'number' && d.v > VERSION;
          } catch (e) {}
          if (future) {
            storage = null;
            mode = 'memory';
          } else {
            storage.removeItem(KEY);
          }
        }
        return;
      } catch (e) {
        storage = null;
        mode = 'memory';
      }
    }
    items = memory.slice();
  }

  function persist() {
    memory = items.slice();
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify({ v: VERSION, items: items }));
    } catch (e) {
      storage = null;
      mode = 'memory';
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
    storageMessage: function () {
      if (mode === 'local') return '';
      return mode === 'session' ? S.t('warnSession') : S.t('warnMemory');
    },
    _changed: function () {
      S.emit('sidonia:favorites', { count: items.length });
    }
  };

  load();
  S.favorites = store;

  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    load();
    store._changed();
  });

  class SidoniaSave extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.hidden = false;
      this._btn = this.querySelector('button');
      this._label = this.querySelector('[data-sidonia-save-label]');
      this._onClick = this._toggle.bind(this);
      this._onChange = this._sync.bind(this);
      if (this._btn) this._btn.addEventListener('click', this._onClick);
      document.addEventListener('sidonia:favorites', this._onChange);
      this._sync();
    }
    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      if (this._btn) this._btn.removeEventListener('click', this._onClick);
      document.removeEventListener('sidonia:favorites', this._onChange);
    }
    _category() {
      var host = this.closest('[data-category]');
      return host ? host.getAttribute('data-category') || '' : '';
    }
    _toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      var info = { id: this.dataset.id, handle: this.dataset.handle, title: this.dataset.title || '' };
      if (!info.id || !info.handle) return;
      var title = info.title || info.handle;
      if (store.has(info.id)) {
        store.remove(info.id);
        S.announce(S.t('removed', { title: title }));
        S.track('favorite_remove', { category: this._category() });
      } else {
        store.add(info);
        S.announce(S.t('added', { title: title }));
        S.track('favorite_add', { category: this._category() });
        if (!store.persistent && !S.__favWarned) {
          S.__favWarned = true;
          S.toast(store.storageMessage());
        }
      }
    }
    _sync() {
      var on = !!this.dataset.id && store.has(this.dataset.id);
      if (this._btn) this._btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (this._label) this._label.textContent = on ? S.t('saved') : S.t('save');
    }
  }
  S.define('sidonia-save', SidoniaSave);

  class SidoniaFavCount extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._onChange = this._sync.bind(this);
      document.addEventListener('sidonia:favorites', this._onChange);
      this._sync();
    }
    disconnectedCallback() {
      this._bound = false;
      document.removeEventListener('sidonia:favorites', this._onChange);
    }
    _sync() {
      var n = store.count();
      this.textContent = n > 99 ? '99+' : String(n);
      this.hidden = n === 0;
      this.setAttribute('aria-hidden', 'true');
      var link = this.closest('[data-sidonia-fav-link]');
      if (link) link.setAttribute('aria-label', n > 0 ? S.t('favLink', { count: n }) : S.t('favLinkEmpty'));
    }
  }
  S.define('sidonia-fav-count', SidoniaFavCount);

  /*
   * Página de Favoritos. Consulta el estado ACTUAL de cada pieza con la vista alternativa
   * /products/<handle>?view=sidonia-card (nunca confía en precios o estados guardados).
   * Piezas retiradas (404) se muestran como «Ya no está publicada» con opción de quitarlas.
   */
  function fetchCard(item, view, signal) {
    var root = (S.config.routes && S.config.routes.root) || '/';
    var url = root.replace(/\/$/, '') + '/products/' + encodeURIComponent(item.handle) + '?view=' + encodeURIComponent(view);
    return fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin', cache: 'no-cache', signal: signal }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.status = res.status;
        throw err;
      }
      try {
        var m = /\/products\/([^/?#]+)/.exec(new URL(res.url).pathname);
        if (m && decodeURIComponent(m[1]) !== item.handle) store.updateHandle(item.id, decodeURIComponent(m[1]));
      } catch (e) {}
      return res.text().then(function (text) {
        var card = S.parseHTML(text).querySelector('[data-sidonia-card]');
        if (!card) {
          var err = new Error('sin tarjeta');
          err.status = 404;
          throw err;
        }
        return document.importNode(card, true);
      });
    });
  }

  class SidoniaFavoritesPage extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.$grid = this.querySelector('[data-sidonia-fav-grid]');
      this.$empty = this.querySelector('[data-sidonia-fav-empty]');
      this.$status = this.querySelector('[data-sidonia-fav-status]');
      this.$warn = this.querySelector('[data-sidonia-fav-warning]');
      var section = this.closest('.sidonia-favorites') || document;
      this.$tools = section.querySelector('sidonia-favorites-tools');
      this.$clear = section.querySelector('[data-sidonia-fav-clear]');
      this.$confirm = section.querySelector('[data-sidonia-fav-confirm]');
      this._abort = null;
      this._rendered = [];

      this._onChange = this._onStoreChange.bind(this);
      document.addEventListener('sidonia:favorites', this._onChange);
      this._onClear = this._askClear.bind(this);
      if (this.$clear) this.$clear.addEventListener('click', this._onClear);
      this._onConfirmClick = function (e) {
        var t = e.target.closest('button');
        if (!t) return;
        if (t.hasAttribute('data-sidonia-confirm')) {
          store.clear();
          S.announce(S.t('favCountOther', { count: 0 }));
        }
        if (t.hasAttribute('data-sidonia-confirm') || t.hasAttribute('data-sidonia-cancel')) S.closeDialog(this.$confirm);
      }.bind(this);
      if (this.$confirm) this.$confirm.addEventListener('click', this._onConfirmClick);
      this._onGridClick = function (e) {
        var btn = e.target.closest && e.target.closest('[data-sidonia-fav-remove]');
        if (!btn) return;
        var li = btn.closest('li');
        if (li && li.dataset.id) store.remove(li.dataset.id);
      };
      this.$grid.addEventListener('click', this._onGridClick);
      this.render();
    }

    disconnectedCallback() {
      if (!this._bound) return;
      this._bound = false;
      document.removeEventListener('sidonia:favorites', this._onChange);
      if (this.$clear) this.$clear.removeEventListener('click', this._onClear);
      if (this.$confirm) this.$confirm.removeEventListener('click', this._onConfirmClick);
      this.$grid.removeEventListener('click', this._onGridClick);
      if (this._abort) this._abort.abort();
    }

    _warn(msg) {
      if (!this.$warn) return;
      this.$warn.hidden = !msg;
      this.$warn.textContent = msg || '';
    }

    _chrome() {
      var n = store.count();
      if (this.$empty) this.$empty.hidden = n > 0;
      if (this.$tools) this.$tools.hidden = n === 0;
      if (this.$status) this.$status.textContent = n > 0 ? S.t(n === 1 ? 'favCountOne' : 'favCountOther', { count: n }) : '';
    }

    _askClear() {
      if (!store.count()) return;
      if (this.$confirm && typeof this.$confirm.showModal === 'function') {
        S.openDialog(this.$confirm);
        var cancel = this.$confirm.querySelector('[data-sidonia-cancel]');
        if (cancel) cancel.focus();
      } else if (window.confirm(S.t('favCountOther', { count: store.count() }))) {
        store.clear();
      }
    }

    _onStoreChange() {
      var ids = store.items.map(function (i) {
        return i.id;
      });
      var self = this;
      var needsRender = ids.some(function (id) {
        return self._rendered.indexOf(id) === -1;
      });
      if (needsRender) return this.render();
      Array.prototype.slice.call(this.$grid.children).forEach(function (li) {
        if (ids.indexOf(li.dataset.id) === -1) li.remove();
      });
      this._rendered = ids;
      this._chrome();
    }

    _retired(item) {
      var li = document.createElement('li');
      li.dataset.id = item.id;
      var box = document.createElement('div');
      box.className = 'sidonia-fav-retired';
      var title = document.createElement('p');
      title.className = 'sidonia-card__title';
      title.textContent = item.title || item.handle;
      var note = document.createElement('p');
      note.className = 'sidonia-note';
      note.textContent = S.t('favRetired');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidonia-btn sidonia-btn--quiet sidonia-btn--sm';
      btn.setAttribute('data-sidonia-fav-remove', '');
      btn.textContent = S.t('favRemove');
      box.appendChild(title);
      box.appendChild(note);
      box.appendChild(btn);
      li.appendChild(box);
      return li;
    }

    _wrap(card, item) {
      var li = document.createElement('li');
      li.className = 'sidonia-fav-item';
      li.dataset.id = item.id;
      li.appendChild(card);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidonia-btn sidonia-btn--quiet sidonia-btn--sm sidonia-fav-item__remove';
      btn.setAttribute('data-sidonia-fav-remove', '');
      btn.textContent = S.t('favRemove');
      li.appendChild(btn);
      return li;
    }

    render() {
      var self = this;
      var list = store.items;
      var view = this.dataset.view || 'sidonia-card';
      this._warn(store.wasCorrupt ? S.t('warnCorrupt') : store.storageMessage());
      this._chrome();
      if (this._abort) this._abort.abort();
      this._abort = typeof AbortController === 'function' ? new AbortController() : null;
      this.$grid.innerHTML = '';
      this._rendered = list.map(function (i) {
        return i.id;
      });
      if (!list.length) return;
      this.$grid.setAttribute('aria-busy', 'true');
      var results = {};
      var queue = list.slice();
      var running = 0;
      var done = 0;
      var failedNetwork = 0;
      var signal = this._abort ? this._abort.signal : undefined;

      function finish() {
        self.$grid.removeAttribute('aria-busy');
        list.forEach(function (it) {
          if (results[it.id]) self.$grid.appendChild(results[it.id]);
        });
        self._chrome();
        if (failedNetwork) self._warn(S.t('warnFetch'));
      }

      function next() {
        while (running < 4 && queue.length) {
          running++;
          (function (it) {
            fetchCard(it, view, signal)
              .then(function (card) {
                results[it.id] = self._wrap(card, it);
              })
              .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                if (!err || err.status !== 404) failedNetwork++;
                results[it.id] = self._retired(it);
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
  }
  S.define('sidonia-favorites-page', SidoniaFavoritesPage);

  /* ------------------------------------------------------------------ 4. compartir */

  class SidoniaShare extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this._btn = this.querySelector('button');
      this._label = this.querySelector('[data-sidonia-share-label]');
      this._onClick = this._share.bind(this);
      if (this._btn) this._btn.addEventListener('click', this._onClick);
      if (!navigator.share && this._label) this._label.textContent = S.t('copyLink');
    }
    disconnectedCallback() {
      this._bound = false;
      if (this._btn) this._btn.removeEventListener('click', this._onClick);
    }
    _share() {
      var url = S.safeUrl(this.dataset.url) || location.href.split('#')[0];
      var title = this.dataset.title || document.title;
      var self = this;
      if (navigator.share) {
        navigator
          .share({ title: title, url: url })
          .then(function () {
            S.track('share', { source: 'web_share' });
          })
          .catch(function () {});
        return;
      }
      function done(ok) {
        var msg = ok ? S.t('linkCopied') : S.t('copyFailed');
        S.announce(msg);
        S.toast(msg);
        if (ok) S.track('share', { source: 'copy' });
        if (self._label) {
          self._label.textContent = msg;
          setTimeout(function () {
            self._label.textContent = S.t('copyLink');
          }, 2400);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            done(true);
          },
          function () {
            done(fallbackCopy(url));
          }
        );
      } else {
        done(fallbackCopy(url));
      }
    }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }
  S.define('sidonia-share', SidoniaShare);

  /* ------------------------------------------------------------------ 5. búsqueda del hero */
  /*
   * Sin texto: abre la colección de la categoría (o «Explorar»). Con texto: /search con la consulta
   * y el filtro real filter.p.m.sidonia.category. Sin JavaScript el formulario GET hace lo mismo
   * (con la consulta vacía, la página de búsqueda ofrece el enlace a la categoría).
   */
  if (!S.__searchBound) {
    S.__searchBound = true;
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.matches || !form.matches('[data-sidonia-search]')) return;
      var q = (form.elements.q && form.elements.q.value || '').trim();
      var radio = form.querySelector('input[type="radio"]:checked');
      var cat = radio ? radio.value : '';
      S.track('search_submit', { category: cat, source: q ? 'text' : 'browse' });
      if (!q) {
        e.preventDefault();
        var target = (radio && S.safeUrl(radio.getAttribute('data-url'))) || S.safeUrl(form.getAttribute('data-explore-url')) || form.action;
        location.href = target;
        return;
      }
      if (!cat && radio) radio.disabled = true;
    });
  }

  /* ------------------------------------------------------------------ 6. clip de fondo */
  /*
   * Bucle silencioso decorativo. Solo si: el navegador acepta play(), no hay «reducir movimiento»,
   * no hay ahorro de datos y (salvo ajuste) no es un dispositivo móvil. Con botón de pausa.
   * Si play() se rechaza, se queda la imagen de portada sin errores visibles.
   */
  class SidoniaAutopreview extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      var mobile = window.matchMedia && window.matchMedia('(max-width: 749px), (pointer: coarse)').matches;
      if (S.prefersReducedMotion() || S.saveData() || (mobile && this.dataset.mobile !== 'true')) return;
      var src = S.safeUrl(this.dataset.src);
      if (!src) return;
      var v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-hidden', 'true');
      v.tabIndex = -1;
      v.preload = 'auto';
      var source = document.createElement('source');
      source.src = src;
      source.type = this.dataset.mime || 'video/mp4';
      v.appendChild(source);
      this.appendChild(v);
      this._video = v;
      var section = this.closest('[data-section-id]') || this.parentNode;
      this._toggle = section && section.querySelector('[data-sidonia-preview-toggle]');
      var self = this;
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          v.classList.add('is-playing');
          if (self._toggle) {
            self._toggle.hidden = false;
            self._onToggle = self._togglePlay.bind(self);
            self._toggle.addEventListener('click', self._onToggle);
          }
        }).catch(function () {
          self._remove();
        });
      }
      if ('IntersectionObserver' in window) {
        this._io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!self._video || self._userPaused) return;
            if (en.isIntersecting) self._video.play().catch(function () {});
            else self._video.pause();
          });
        });
        this._io.observe(this);
      }
    }
    _togglePlay() {
      if (!this._video) return;
      if (this._video.paused) {
        this._userPaused = false;
        this._video.play().catch(function () {});
        this._toggle.setAttribute('aria-pressed', 'false');
      } else {
        this._userPaused = true;
        this._video.pause();
        this._toggle.setAttribute('aria-pressed', 'true');
      }
    }
    _remove() {
      if (this._video) {
        try {
          this._video.pause();
        } catch (e) {}
        this._video.remove();
        this._video = null;
      }
      if (this._toggle) this._toggle.hidden = true;
    }
    disconnectedCallback() {
      this._bound = false;
      if (this._io) this._io.disconnect();
      if (this._toggle && this._onToggle) this._toggle.removeEventListener('click', this._onToggle);
      this._remove();
    }
  }
  S.define('sidonia-autopreview', SidoniaAutopreview);

  /* ------------------------------------------------------------------ 7. cabecera transparente */
  /*
   * Contrato del kit (ver docs/09-guia-cabecera-y-datos-publicos.md):
   *  - Una sección compatible (hero o cabecera de página con imagen) que es la PRIMERA de la plantilla
   *    marca data-sidonia-header-overlay="true".
   *  - La cabecera que participa lleva data-sidonia-header. El estado se publica en
   *    <html data-sidonia-header="overlay|solid">: «overlay» mientras el bloque visual está bajo la
   *    cabecera; «solid» al superarlo, al abrir un panel (menú, búsqueda) o si no hay bloque.
   *  - El primer render ya es correcto sin JS gracias a :has() en el CSS de integración; este
   *    script solo añade el cambio al desplazar y los paneles abiertos.
   * Si Impact resuelve todo esto con su mecanismo nativo, la integración no usa este módulo.
   */
  function headerController() {
    var header = document.querySelector('[data-sidonia-header]');
    if (!header) return;
    var root = document.documentElement;
    var hero = null;
    var main = document.querySelector('main') || document.body;
    var first = main.querySelector('.shopify-section');
    if (first) hero = first.querySelector('[data-sidonia-header-overlay="true"]');
    if (S.__headerIo) S.__headerIo.disconnect();
    if (!hero) {
      root.setAttribute('data-sidonia-header', 'solid');
      return;
    }
    var overHero = true;
    function apply() {
      var panelOpen = !!header.querySelector('[data-sidonia-header-panel][open], [data-sidonia-header-panel].is-open') || header.classList.contains('is-panel-open');
      root.setAttribute('data-sidonia-header', overHero && !panelOpen ? 'overlay' : 'solid');
    }
    S.__headerApply = apply;
    if ('IntersectionObserver' in window) {
      var h = header.getBoundingClientRect().height || 64;
      S.__headerIo = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            overHero = en.isIntersecting;
          });
          apply();
        },
        { rootMargin: '-' + Math.round(h) + 'px 0px 0px 0px', threshold: 0 }
      );
      S.__headerIo.observe(hero);
    }
    apply();
  }
  S.headerController = headerController;
  if (!S.__headerBound) {
    S.__headerBound = true;
    document.addEventListener('toggle', function () {
      if (S.__headerApply) S.__headerApply();
    }, true);
    document.addEventListener('sidonia:header-panel', function () {
      if (S.__headerApply) S.__headerApply();
    });
    document.addEventListener('shopify:section:load', headerController);
    document.addEventListener('shopify:section:unload', function () {
      setTimeout(headerController, 0);
    });
    document.addEventListener('shopify:section:reorder', headerController);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', headerController);
  else headerController();
})();
