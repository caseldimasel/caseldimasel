/* SIDONIA · formularios
 *
 * Mejora progresiva sobre el formulario de contacto NATIVO de Shopify ({% form 'contact' %}):
 *  - Sin JavaScript, el formulario se envía normalmente y Shopify devuelve la página con
 *    form.posted_successfully? o con form.errors.
 *  - Con JavaScript se valida antes de enviar y se envía por fetch al mismo destino. El éxito se decide
 *    SOLO a partir de la respuesta real de Shopify (la página devuelta contiene el aviso de éxito generado
 *    por el servidor). Nunca por un temporizador ni por pulsar el botón.
 *  - Si la respuesta no se entiende (por ejemplo una pantalla de verificación anti-spam), se reenvía de
 *    forma nativa para que el navegador la gestione.
 *  - Si falla la red, se conservan todos los datos y se ofrece reintentar.
 * Elementos: <sd-form data-kind="inquiry|wanted|contact"> y <sd-sell-form data-kind="owner">.
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__forms) return;
  S.__forms = true;

  var ICON_ALERT =
    '<svg class="sd-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4l9 16H3z"/><path d="M12 10.5v4M12 17.5v.01"/></svg>';

  function fieldOf(el) {
    return el.closest('[data-sd-field]');
  }

  function errorSlot(el) {
    var f = fieldOf(el);
    if (f) return f.querySelector('[data-sd-error]');
    var fs = el.closest('fieldset');
    return fs ? fs.querySelector('[data-sd-error]') : null;
  }

  function setError(el, message) {
    var slot = errorSlot(el);
    var f = fieldOf(el);
    el.setAttribute('aria-invalid', 'true');
    if (f) f.classList.add('sd-field--error');
    if (slot) {
      slot.innerHTML = ICON_ALERT;
      var span = document.createElement('span');
      span.textContent = message;
      slot.appendChild(span);
      if (slot.id && !(el.getAttribute('aria-describedby') || '').includes(slot.id)) {
        el.setAttribute('aria-describedby', ((el.getAttribute('aria-describedby') || '') + ' ' + slot.id).trim());
      }
    }
  }

  function clearError(el) {
    var f = fieldOf(el);
    el.removeAttribute('aria-invalid');
    if (f) f.classList.remove('sd-field--error');
    var slot = errorSlot(el);
    if (slot && f) slot.innerHTML = '';
  }

  function messageFor(el) {
    var v = el.validity;
    if (v.valueMissing) {
      if (el.type === 'checkbox' && /privacy|privacidad/i.test(el.id + el.name)) return S.t('forms.err_privacy');
      return S.t('forms.err_required');
    }
    if (v.typeMismatch) {
      if (el.type === 'email') return S.t('forms.err_email');
      if (el.type === 'url') return S.t('forms.err_url');
    }
    if (v.rangeUnderflow || v.rangeOverflow || v.badInput) return S.t('forms.err_number');
    return S.t('forms.err_invalid');
  }

  class SdForm extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.kind = this.dataset.kind || 'form';
      this._busy = false;
      this._attach();
    }

    disconnectedCallback() {
      this._bound = false;
      this._detach();
    }

    _attach() {
      this.form = this.querySelector('form');
      if (!this.form) return;
      this.$status = this.form.querySelector('[data-sd-status]');
      this._onSubmit = this._submit.bind(this);
      this._onInput = this._input.bind(this);
      this._onChange = this._change.bind(this);
      this.form.addEventListener('submit', this._onSubmit);
      this.form.addEventListener('input', this._onInput);
      this.form.addEventListener('change', this._onChange);
      this._started = false;
      this._syncPhoneRequirement();
    }

    _detach() {
      if (!this.form) return;
      this.form.removeEventListener('submit', this._onSubmit);
      this.form.removeEventListener('input', this._onInput);
      this.form.removeEventListener('change', this._onChange);
    }

    /* ---- eventos ---- */
    _input(e) {
      var el = e.target;
      if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') clearError(el);
      if (!this._started) {
        this._started = true;
        S.track('form_start', { kind: this.kind, category: this._category() }, { once: true, key: 'form_start:' + this.kind });
      }
    }

    _change(e) {
      if (e.target && e.target.name === 'contact[Preferencia de contacto]') this._syncPhoneRequirement();
    }

    _category() {
      return this.category || this.dataset.category || '';
    }

    /** WhatsApp o Teléfono como canal preferido exigen un teléfono. */
    _syncPhoneRequirement() {
      var phone = this.form && this.form.querySelector('input[name="contact[phone]"]');
      if (!phone) return;
      if (!phone.hasAttribute('data-sd-base-required')) {
        phone.setAttribute('data-sd-base-required', phone.required ? '1' : '0');
      }
      var base = phone.getAttribute('data-sd-base-required') === '1';
      var needs = this.form.querySelector('input[data-sd-needs-phone]:checked');
      phone.required = base || !!needs;
      if (phone.required) phone.setAttribute('aria-required', 'true');
      else phone.removeAttribute('aria-required');
    }

    /* ---- validación ---- */
    validate(scope) {
      var root = scope || this.form;
      var errors = [];
      var groups = {};
      Array.prototype.forEach.call(root.querySelectorAll('input, select, textarea'), function (el) {
        if (!el.name || el.disabled || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        if (el.type === 'radio') {
          groups[el.name] = groups[el.name] || [];
          groups[el.name].push(el);
          return;
        }
        clearError(el);
        if (!el.checkValidity()) errors.push({ el: el, message: messageFor(el) });
      });
      Object.keys(groups).forEach(function (name) {
        var list = groups[name];
        list.forEach(clearError);
        var required = list.some(function (r) {
          return r.required;
        });
        var any = list.some(function (r) {
          return r.checked;
        });
        if (required && !any) errors.push({ el: list[0], message: S.t('forms.err_choose'), group: true });
      });
      return errors;
    }

    _showErrors(errors) {
      errors.forEach(function (e) {
        setError(e.el, e.message);
      });
      var n = errors.length;
      var msg = S.t(n === 1 ? 'forms.review_one' : 'forms.review_other', { count: n });
      if (this.$status) this.$status.textContent = msg;
      S.announce(msg);
      var first = errors[0].el;
      first.focus({ preventScroll: false });
    }

    /* ---- envío ---- */
    _submit(e) {
      e.preventDefault();
      if (this._busy) return;
      if (this.$status) this.$status.textContent = '';
      var errors = this.validate();
      if (errors.length) {
        this._showErrors(errors);
        return;
      }
      this._send();
    }

    _setBusy(on) {
      this._busy = on;
      var btn = this.form && this.form.querySelector('[data-sd-submit]');
      if (btn) {
        if (on) {
          btn.setAttribute('aria-busy', 'true');
          btn.setAttribute('aria-disabled', 'true');
        } else {
          btn.removeAttribute('aria-busy');
          btn.removeAttribute('aria-disabled');
        }
      }
    }

    _send() {
      var self = this;
      var form = this.form;
      this._setBusy(true);
      if (this.$status) this.$status.textContent = S.t('forms.sending');
      var action = form.getAttribute('action') || location.pathname;
      fetch(action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: { Accept: 'text/html' }
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { res: res, text: text };
          });
        })
        .then(function (r) {
          self._handle(r.res, r.text);
        })
        .catch(function () {
          self._fail();
        })
        .then(function () {
          self._setBusy(false);
        });
    }

    _handle(res, text) {
      var form = this.form;
      if (/\/challenge(\b|\/|\?)/.test(res.url || '') || res.status >= 500) {
        this._native();
        return;
      }
      var doc = S.parseHTML(text);
      var fresh = form.id ? doc.getElementById(form.id) : null;
      if (fresh && fresh.querySelector('[data-sd-form-success]')) {
        this._detach();
        form.innerHTML = fresh.innerHTML;
        var ok = form.querySelector('[data-sd-form-success]');
        if (ok) ok.focus();
        S.announce(S.text(ok));
        S.track('form_submit_success', { kind: this.kind, category: this._category() });
        this._afterReplace(true);
        return;
      }
      if (fresh && fresh.querySelector('[data-sd-form-errors]')) {
        this._detach();
        form.innerHTML = fresh.innerHTML;
        var err = form.querySelector('[data-sd-form-errors]');
        if (err) err.focus();
        S.announce(S.text(err));
        this._afterReplace(false);
        return;
      }
      // Respuesta que no entendemos: que lo gestione el navegador con el envío nativo.
      this._native();
    }

    _afterReplace() {
      this._attach();
    }

    _fail() {
      var msg = S.t('forms.network_error');
      if (this.$status) this.$status.textContent = msg;
      S.announce(msg);
      var btn = this.form.querySelector('[data-sd-submit]');
      if (btn) btn.focus();
    }

    _native() {
      this._detach();
      this.form.submit();
    }
  }
  S.define('sd-form', SdForm);

  /* ---------------- Formulario de propietarios en tres pasos ---------------- */
  class SdSellForm extends SdForm {
    _attach() {
      super._attach();
      this._initWizard();
    }

    _afterReplace(success) {
      super._afterReplace(success);
      // Tras un error del servidor volvemos al último paso con los datos conservados
      if (!success && this.steps && this.steps.length) this._show(3, true);
    }

    _initWizard() {
      var form = this.form;
      if (!form) return;
      this.steps = Array.prototype.slice.call(form.querySelectorAll('[data-sd-step]'));
      if (!this.steps.length) return; // estado de éxito
      this.$stepper = form.querySelector('[data-sd-stepper]');
      this.$nav = form.querySelector('[data-sd-nav]');
      this.$prev = form.querySelector('[data-sd-prev]');
      this.$next = form.querySelector('[data-sd-next]');
      this.groups = Array.prototype.slice.call(form.querySelectorAll('[data-sd-cat-group]'));
      this.current = 1;

      form.classList.add('is-wizard');
      if (this.$stepper) this.$stepper.hidden = false;
      if (this.$nav) this.$nav.hidden = false;

      var self = this;
      this._catHandler = function (e) {
        var r = e.target;
        if (r && r.getAttribute && r.getAttribute('data-sd-cat')) self._setCategory(r.getAttribute('data-sd-cat'));
      };
      form.addEventListener('change', this._catHandler);

      this._navHandler = function (e) {
        if (e.target.closest('[data-sd-next]')) self._next();
        else if (e.target.closest('[data-sd-prev]')) self._prev();
      };
      form.addEventListener('click', this._navHandler);

      // Intro en pasos 1 y 2 avanza; no envía
      this._keyHandler = function (e) {
        if (e.key !== 'Enter') return;
        var t = e.target;
        if (!t || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
        if (self.current < 3) {
          e.preventDefault();
          self._next();
        }
      };
      form.addEventListener('keydown', this._keyHandler);

      var checked = form.querySelector('input[data-sd-cat]:checked');
      this._setCategory(checked ? checked.getAttribute('data-sd-cat') : '');

      // ?cat=garage|harbor|estate preselecciona la categoría y salta al paso 2
      var pre = '';
      try {
        pre = new URLSearchParams(location.search).get('cat') || '';
      } catch (e) {}
      if (!checked && /^(garage|harbor|estate)$/.test(pre)) {
        var radio = form.querySelector('input[data-sd-cat="' + pre + '"]');
        if (radio) {
          radio.checked = true;
          this._setCategory(pre);
          this._show(2, false);
          return;
        }
      }
      this._show(1, false);
    }

    _detach() {
      if (this.form) {
        if (this._catHandler) this.form.removeEventListener('change', this._catHandler);
        if (this._navHandler) this.form.removeEventListener('click', this._navHandler);
        if (this._keyHandler) this.form.removeEventListener('keydown', this._keyHandler);
      }
      super._detach();
    }

    _setCategory(cat) {
      this.category = cat;
      this.groups.forEach(function (g) {
        var on = g.getAttribute('data-sd-cat-group') === cat;
        g.hidden = !on;
        Array.prototype.forEach.call(g.querySelectorAll('input, select, textarea'), function (el) {
          el.disabled = !on;
        });
      });
    }

    _stepEl(n) {
      return this.steps.filter(function (s) {
        return Number(s.getAttribute('data-sd-step')) === n;
      })[0];
    }

    _show(n, focus) {
      this.current = n;
      this.steps.forEach(function (s) {
        s.hidden = Number(s.getAttribute('data-sd-step')) !== n;
      });
      if (this.$stepper) {
        Array.prototype.forEach.call(this.$stepper.querySelectorAll('[data-sd-stepper-item]'), function (li) {
          var i = Number(li.getAttribute('data-sd-stepper-item'));
          li.classList.toggle('is-done', i < n);
          if (i === n) li.setAttribute('aria-current', 'step');
          else li.removeAttribute('aria-current');
        });
      }
      if (this.$prev) this.$prev.hidden = n === 1;
      if (this.$next) this.$next.hidden = n === 3;
      if (focus !== false) {
        var legend = this._stepEl(n).querySelector('legend');
        if (legend) {
          legend.setAttribute('tabindex', '-1');
          legend.focus({ preventScroll: true });
        }
        this.form.scrollIntoView({ behavior: S.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        S.announce(S.t('sell.step_announce', { n: n, total: 3 }));
      }
    }

    _next() {
      var step = this._stepEl(this.current);
      var errors = this.validate(step);
      var slot = step.querySelector('[data-sd-step-error]');
      if (slot) slot.innerHTML = '';
      if (errors.length) {
        if (this.current === 1 && slot) {
          slot.innerHTML = ICON_ALERT;
          var span = document.createElement('span');
          span.textContent = S.t('sell.err_category');
          slot.appendChild(span);
          errors[0].el.focus();
          S.announce(S.t('sell.err_category'));
        } else {
          this._showErrors(errors);
        }
        return;
      }
      if (this.current < 3) this._show(this.current + 1, true);
    }

    _prev() {
      if (this.current > 1) this._show(this.current - 1, true);
    }

    _submit(e) {
      if (this.current < 3 && this.steps && this.steps.length) {
        e.preventDefault();
        this._next();
        return;
      }
      // Antes de enviar, se comprueban también los pasos anteriores (están ocultos pero activos)
      var all = super.validate(this.form);
      if (all.length) {
        e.preventDefault();
        var stepEl = all[0].el.closest('[data-sd-step]');
        var firstStep = stepEl ? Number(stepEl.getAttribute('data-sd-step')) : 3;
        if (firstStep !== this.current) this._show(firstStep, true);
        this._showErrors(all);
        return;
      }
      super._submit(e);
    }

    _category() {
      return this.category || '';
    }
  }
  S.define('sd-sell-form', SdSellForm);
})();
