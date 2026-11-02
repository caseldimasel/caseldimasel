/* SIDONIA · núcleo
 * Espacio de nombres, configuración, utilidades y avisos accesibles.
 * Sin dependencias. Todos los módulos son idempotentes: pueden cargarse dos veces (editor de temas) sin duplicar nada.
 */
(function () {
  'use strict';
  if (window.Sidonia && window.Sidonia.__core) return;

  var S = (window.Sidonia = window.Sidonia || {});
  S.__core = true;

  function readConfig() {
    try {
      var el = document.getElementById('sd-config');
      return el ? JSON.parse(el.textContent) : {};
    } catch (e) {
      return {};
    }
  }

  S.config = readConfig();

  /** Cadena traducida (viene de locales/es.default.json vía #sd-config). */
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

  /** Registra un custom element solo una vez. */
  S.define = function (name, ctor) {
    if (!window.customElements || window.customElements.get(name)) return;
    window.customElements.define(name, ctor);
  };

  S.debounce = function (fn, wait) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  };

  S.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  };

  var liveTimer;
  /** Anuncia un cambio importante a lectores de pantalla (región polite, un solo mensaje cada vez). */
  S.announce = function (message) {
    var live = document.getElementById('sd-live');
    if (!live || !message) return;
    clearTimeout(liveTimer);
    live.textContent = '';
    liveTimer = setTimeout(function () {
      live.textContent = message;
    }, 60);
  };

  /** Aviso visual breve. Es decorativo (aria-hidden): el anuncio accesible va por S.announce. */
  S.toast = function (message) {
    var old = document.querySelector('.sd-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'sd-toast';
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

  /** Ahorro de datos o conexión lenta, cuando el navegador lo expone. */
  S.saveData = function () {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /(^|-)(2g|3g)$/.test(c.effectiveType || '');
  };

  S.isDesignMode = function () {
    return document.body && document.body.getAttribute('data-design-mode') === 'true';
  };

  /** Abre un <dialog> como modal con alternativa si el navegador no lo soporta. */
  S.openDialog = function (dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    document.documentElement.classList.add('sd-lock');
  };

  function hasOpenModal() {
    try {
      return !!document.querySelector('dialog:modal');
    } catch (e) {
      return !!document.querySelector('dialog[open]:not(.sd-filters)');
    }
  }

  S.closeDialog = function (dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
    if (!hasOpenModal()) {
      document.documentElement.classList.remove('sd-lock');
    }
  };

  /** Cierra el dialog al hacer clic en el fondo (fuera de su caja). */
  S.closeOnBackdrop = function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target !== dialog) return;
      var r = dialog.getBoundingClientRect();
      var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) S.closeDialog(dialog);
    });
  };

  document.addEventListener(
    'close',
    function (e) {
      if (e.target && e.target.tagName === 'DIALOG' && !hasOpenModal()) {
        document.documentElement.classList.remove('sd-lock');
      }
    },
    true
  );

  S.parseHTML = function (text) {
    return new DOMParser().parseFromString(text, 'text/html');
  };

  /** Texto plano de un nodo (para comparar o anunciar). */
  S.text = function (el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  /** Solo se acepta http(s) y rutas relativas en URLs que vienen de atributos data-*. */
  S.safeUrl = function (value) {
    if (!value) return '';
    try {
      var u = new URL(value, location.href);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) {
      return '';
    }
  };
})();
