/* SIDONIA · adaptador de analítica (opcional y desacoplado)
 *
 * - Apagado por defecto (Ajustes del tema > Analítica).
 * - No envía nunca mensajes, emails, teléfonos ni textos de búsqueda: solo propiedades de una lista blanca.
 * - Si «exigir consentimiento» está activo y la API de privacidad de Shopify no confirma el permiso, no se envía nada.
 * - Un clic en WhatsApp o email NO es un lead recibido: se registra como clic, nada más.
 * - Sinks: eventos personalizados de Shopify (píxeles web) y, si se activa, window.dataLayer.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__analytics) return;
  S.__analytics = true;

  var seen = Object.create(null);
  var ALLOWED = {
    category: 1,
    status: 1,
    listing_id: 1,
    kind: 1,
    milestone: 1,
    video_kind: 1,
    source: 1,
    filter_keys: 1,
    results_count: 1,
    step: 1
  };

  function cfg() {
    return (S.config && S.config.analytics) || {};
  }

  function clean(props) {
    var out = {};
    if (!props) return out;
    Object.keys(props).forEach(function (k) {
      if (!ALLOWED[k]) return;
      var v = props[k];
      if (typeof v === 'number' && isFinite(v)) {
        out[k] = v;
      } else if (typeof v === 'string') {
        v = v.slice(0, 80);
        // Descarta cualquier cosa que parezca un email o un teléfono.
        if (/@/.test(v) || /\d{7,}/.test(v.replace(/[\s.-]/g, ''))) return;
        out[k] = v;
      } else if (typeof v === 'boolean') {
        out[k] = v;
      }
    });
    return out;
  }

  function consentOk() {
    var c = cfg();
    if (!c.requireConsent) return true;
    var cp = window.Shopify && window.Shopify.customerPrivacy;
    if (!cp || typeof cp.analyticsProcessingAllowed !== 'function') return false;
    try {
      return !!cp.analyticsProcessingAllowed();
    } catch (e) {
      return false;
    }
  }

  // Carga la API de consentimiento de Shopify si hace falta (no carga ningún tercero).
  if (cfg().enabled && cfg().requireConsent && window.Shopify && typeof window.Shopify.loadFeatures === 'function') {
    try {
      window.Shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], function () {});
    } catch (e) {
      /* sin consentimiento disponible: no se enviará nada */
    }
  }

  /**
   * S.track(nombre, propiedades, { once: true, key: 'clave' })
   * «once» evita duplicados tras recargar secciones del editor.
   */
  S.track = function (name, props, opts) {
    var c = cfg();
    if (!c.enabled || !name) return;
    var key = null;
    if (opts && opts.once) {
      key = opts.key || name;
      if (seen[key]) return;
    }
    if (!consentOk()) return;
    if (key) seen[key] = true;

    var payload = clean(props);
    var eventName = 'sidonia_' + name;
    try {
      if (c.sinkShopify && window.Shopify && window.Shopify.analytics && typeof window.Shopify.analytics.publish === 'function') {
        window.Shopify.analytics.publish(eventName, payload);
      }
      if (c.sinkDataLayer) {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(Object.assign({ event: eventName }, payload));
      }
    } catch (e) {
      /* la analítica nunca debe romper la página */
    }
    document.dispatchEvent(new CustomEvent('sd:track', { detail: { name: name, props: payload } }));
  };

  // Clics en WhatsApp / email: [data-sd-track="contact_whatsapp" data-sd-track-category="garage"]
  if (!S.__trackClick) {
    S.__trackClick = true;
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-sd-track]');
      if (!a) return;
      var name = a.getAttribute('data-sd-track');
      if (name === 'contact_whatsapp' || name === 'contact_email') {
        S.track(name + '_click', { category: a.getAttribute('data-sd-track-category') || '' });
      }
    });
  }

  // <sd-track data-event="view_listing" data-key="…" data-category="…" data-status="…"></sd-track>
  class SdTrack extends HTMLElement {
    connectedCallback() {
      var d = this.dataset;
      S.track(
        d.event,
        { category: d.category, status: d.status },
        { once: true, key: d.key || d.event }
      );
    }
  }
  S.define('sd-track', SdTrack);
})();
