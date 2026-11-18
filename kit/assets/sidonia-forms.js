/* SIDONIA · formularios (consulta de pieza, contacto, «qué buscas» y solicitud de venta)
 *
 * Mejora progresiva sobre el formulario de contacto NATIVO de Shopify ({% form 'contact' %}):
 *  - Sin JavaScript se envía normalmente y Shopify devuelve la página con form.posted_successfully?
 *    o con form.errors (snippet sidonia-form-status).
 *  - Con JavaScript se valida antes de enviar y se envía por fetch al mismo destino. El éxito se decide
 *    SOLO con la respuesta real de Shopify (el aviso de éxito que genera el servidor para ESTE
 *    formulario). Nunca por un temporizador ni por pulsar el botón.
 *  - Si la respuesta no se entiende (p. ej. la verificación anti-spam de Shopify), se reenvía de forma
 *    nativa para que el navegador la muestre. Si falla la red, se conservan los datos y se puede reintentar.
 *  - Nada del formulario se guarda en el navegador ni se envía a analítica (solo «inicio» y «envío
 *    confirmado», con la categoría o la referencia de la pieza).
 *
 * Formulario de venta (data-sidonia-form="sell"): tres pasos, preselección validada con ?categoria=,
 * y los grupos de categorías no elegidas se desactivan (no se validan ni se envían).
 */
(function () {
  'use strict';
  var S = window.Sidonia;
  if (!S || S.__forms) return;
  S.__forms = true;

  function fieldBox(el) {
    return el.closest('.sidonia-field');
  }

  function errorSlot(el) {
    var box = fieldBox(el);
    if (box) {
      var direct = box.querySelector(':scope > .sidonia-field__error');
      if (direct) return direct;
    }
    var fs = el.closest('fieldset');
    return fs ? fs.querySelector('.sidonia-field__error') : null;
  }

  function setError(el, message) {
    el.setAttribute('aria-invalid', 'true');
    var slot = errorSlot(el);
    if (!slot) return;
    slot.textContent = message;
    slot.hidden = false;
    if (!slot.id) slot.id = 'sidonia-err-' + Math.random().toString(36).slice(2, 9);
    var desc = el.getAttribute('aria-describedby') || '';
    if (desc.split(' ').indexOf(slot.id) === -1) el.setAttribute('aria-describedby', (desc + ' ' + slot.id).trim());
  }

  function clearError(el) {
    el.removeAttribute('aria-invalid');
    var slot = errorSlot(el);
    if (slot) {
      slot.textContent = '';
      slot.hidden = true;
    }
  }

  function messageFor(el) {
    var v = el.validity;
    if (v.valueMissing) {
      if (el.hasAttribute('data-sidonia-privacy')) return S.t('privacy');
      if (el.type === 'radio') return S.t('choose');
      return S.t('required');
    }
    if (v.typeMismatch) return el.type === 'url' ? S.t('url') : S.t('email');
    if (v.rangeUnderflow || v.rangeOverflow || v.badInput || v.stepMismatch) return S.t('number');
    return S.t('required');
  }

  function Controller(root) {
    this.root = root;
    this.kind = root.getAttribute('data-sidonia-form') || 'form';
    this.busy = false;
    this.started = false;
    this.attach();
  }

  Controller.prototype.attach = function () {
    this.form = this.root.querySelector('form');
    if (!this.form) return;
    this.form.noValidate = true;
    this.submitBtn = this.form.querySelector('[data-sidonia-submit]');
    this.status = this.form.querySelector('[data-sidonia-client-status]');
    if (!this.status && this.submitBtn) {
      this.status = document.createElement('p');
      this.status.className = 'sidonia-note';
      this.status.setAttribute('role', 'status');
      this.status.setAttribute('data-sidonia-client-status', '');
      this.submitBtn.parentNode.appendChild(this.status);
    }
    var self = this;
    this.onSubmit = function (e) {
      self.submit(e);
    };
    this.onInput = function (e) {
      var el = e.target;
      if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') {
        if (el.type === 'radio') {
          Array.prototype.forEach.call(self.form.querySelectorAll('input[name="' + CSS.escape(el.name) + '"]'), clearError);
        } else clearError(el);
      }
      if (!self.started && el.name) {
        self.started = true;
        S.track('form_start', { form: self.kind, category: self.categoryLabel() }, 'form_start:' + self.kind);
      }
      if (el.name === 'contact[Canal preferido]') self.syncPhone();
    };
    this.form.addEventListener('submit', this.onSubmit);
    this.form.addEventListener('input', this.onInput);
    this.form.addEventListener('change', this.onInput);
    this.syncPhone();
    if (this.kind === 'sell') this.initSteps();
    var success = this.form.querySelector('[data-sidonia-form-success]');
    if (success && location.search.indexOf('contact_posted=true') > -1) {
      S.track('form_submit_success', { form: this.kind }, 'form_success:' + this.kind);
    }
  };

  Controller.prototype.detach = function () {
    if (!this.form) return;
    this.form.removeEventListener('submit', this.onSubmit);
    this.form.removeEventListener('input', this.onInput);
    this.form.removeEventListener('change', this.onInput);
    if (this.onStepClick) this.form.removeEventListener('click', this.onStepClick);
    if (this.onStepKey) this.form.removeEventListener('keydown', this.onStepKey);
  };

  Controller.prototype.categoryLabel = function () {
    var r = this.form && this.form.querySelector('input[name="contact[Categoría]"]:checked, input[type="hidden"][name="contact[Categoría]"]');
    return r ? r.value : '';
  };

  Controller.prototype.ref = function () {
    var r = this.form && this.form.querySelector('input[name="contact[Referencia]"]');
    return r ? r.value : '';
  };

  /** WhatsApp o Teléfono como canal preferido exigen un teléfono. */
  Controller.prototype.syncPhone = function () {
    var phone = this.form && this.form.querySelector('input[name="contact[phone]"]');
    if (!phone) return;
    if (!phone.hasAttribute('data-base-required')) phone.setAttribute('data-base-required', phone.required ? '1' : '0');
    var needs = !!this.form.querySelector('input[data-needs-phone]:checked');
    phone.required = phone.getAttribute('data-base-required') === '1' || needs;
    if (phone.required) phone.setAttribute('aria-required', 'true');
    else {
      phone.removeAttribute('aria-required');
      clearError(phone);
    }
  };

  Controller.prototype.validate = function (scope) {
    var root = scope || this.form;
    var errors = [];
    var groups = {};
    Array.prototype.forEach.call(root.querySelectorAll('input, select, textarea'), function (el) {
      if (!el.name || el.disabled || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      if (el.closest('fieldset[disabled]')) return;
      if (el.type === 'radio') {
        (groups[el.name] = groups[el.name] || []).push(el);
        return;
      }
      clearError(el);
      if (el.value && el.type !== 'checkbox') el.value = el.type === 'email' || el.type === 'url' ? el.value.trim() : el.value;
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
      if (required && !any) errors.push({ el: list[0], message: S.t('choose') });
    });
    return errors;
  };

  Controller.prototype.showErrors = function (errors) {
    errors.forEach(function (e) {
      setError(e.el, e.message);
    });
    var n = errors.length;
    var msg = S.t(n === 1 ? 'reviewOne' : 'reviewOther', { count: n });
    if (this.status) this.status.textContent = msg;
    S.announce(msg);
    errors[0].el.focus();
  };

  Controller.prototype.setBusy = function (on) {
    this.busy = on;
    if (!this.submitBtn) return;
    if (on) {
      this.submitBtn.setAttribute('aria-busy', 'true');
      this.submitBtn.setAttribute('aria-disabled', 'true');
    } else {
      this.submitBtn.removeAttribute('aria-busy');
      this.submitBtn.removeAttribute('aria-disabled');
    }
  };

  Controller.prototype.submit = function (e) {
    if (this.kind === 'sell' && this.steps && this.current < this.steps.length) {
      e.preventDefault();
      this.next();
      return;
    }
    e.preventDefault();
    if (this.busy) return;
    if (this.status) this.status.textContent = '';
    var errors = this.validate();
    if (errors.length) {
      if (this.kind === 'sell' && this.steps) {
        var stepEl = errors[0].el.closest('[data-sidonia-step]');
        var n = stepEl ? Number(stepEl.getAttribute('data-sidonia-step')) : this.current;
        if (n !== this.current) this.show(n, false);
      }
      this.showErrors(errors);
      return;
    }
    this.send();
  };

  Controller.prototype.send = function () {
    var self = this;
    this.setBusy(true);
    if (this.status) this.status.textContent = S.t('sending');
    S.announce(S.t('sending'));
    // Si la conexión se queda colgada, a los 25 s se avisa como fallo de red (los datos siguen en el formulario).
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    fetch(this.form.getAttribute('action') || location.pathname, {
      method: 'POST',
      body: new FormData(this.form),
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        return res.text().then(function (text) {
          self.handle(res, text);
        });
      })
      .catch(function () {
        var msg = S.t('networkError');
        if (self.status) self.status.textContent = msg;
        S.announce(msg);
        if (self.submitBtn) self.submitBtn.focus();
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        self.setBusy(false);
      });
  };

  Controller.prototype.handle = function (res, text) {
    if (/\/challenge(\b|\/|\?|$)/.test(res.url || '') || res.status >= 500) return this.native();
    var doc = S.parseHTML(text);
    var fresh = this.form.id ? doc.getElementById(this.form.id) : null;
    if (fresh && fresh.querySelector('[data-sidonia-form-success]')) {
      var category = this.categoryLabel();
      var ref = this.ref();
      this.detach();
      this.form.innerHTML = fresh.innerHTML;
      var ok = this.form.querySelector('[data-sidonia-form-status]');
      if (ok) ok.focus();
      S.announce((ok && ok.textContent.replace(/\s+/g, ' ').trim()) || '');
      S.track('form_submit_success', { form: this.kind, category: category, ref: ref });
      this.attach();
      return;
    }
    if (fresh && fresh.querySelector('[data-sidonia-form-errors]')) {
      // Se conservan los datos: solo se sustituye el bloque de estado y se marcan los campos.
      var statusNew = fresh.querySelector('[data-sidonia-form-status]');
      var statusCur = this.form.querySelector('[data-sidonia-form-status]');
      if (statusNew && statusCur) statusCur.innerHTML = statusNew.innerHTML;
      var self = this;
      Array.prototype.forEach.call(fresh.querySelectorAll('[data-sidonia-form-errors] li[data-field]'), function (li) {
        var field = li.getAttribute('data-field');
        var input = self.form.querySelector('[name="contact[' + field + ']"]');
        if (input) setError(input, li.textContent.replace(/\s+/g, ' ').trim());
      });
      if (this.kind === 'sell' && this.steps) this.show(this.steps.length, false);
      if (statusCur) statusCur.focus();
      S.announce(statusCur ? statusCur.textContent.replace(/\s+/g, ' ').trim() : '');
      return;
    }
    this.native();
  };

  Controller.prototype.native = function () {
    this.detach();
    HTMLFormElement.prototype.submit.call(this.form);
  };

  /* ---------------- pasos del formulario de venta ---------------- */

  Controller.prototype.initSteps = function () {
    var form = this.form;
    this.steps = Array.prototype.slice.call(form.querySelectorAll('[data-sidonia-step]'));
    if (!this.steps.length) {
      this.steps = null;
      return;
    }
    this.groups = Array.prototype.slice.call(form.querySelectorAll('[data-sidonia-cat-group]'));
    this.progress = form.querySelector('[data-sidonia-progress]');
    this.progressText = form.querySelector('[data-sidonia-progress-text]');
    this.nav = form.querySelector('[data-sidonia-stepnav]');
    this.prevBtn = form.querySelector('[data-sidonia-prev]');
    this.nextBtn = form.querySelector('[data-sidonia-next]');
    form.classList.add('sidonia-form--stepped');
    if (this.progress) this.progress.hidden = false;
    if (this.nav) this.nav.hidden = false;
    var self = this;
    this.onStepClick = function (e) {
      if (e.target.closest('[data-sidonia-next]')) {
        e.preventDefault();
        self.next();
      } else if (e.target.closest('[data-sidonia-prev]')) {
        e.preventDefault();
        self.prev();
      }
    };
    form.addEventListener('click', this.onStepClick);
    this.onStepKey = function (e) {
      if (e.key !== 'Enter') return;
      var t = e.target;
      if (!t || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
      if (self.current < self.steps.length) {
        e.preventDefault();
        self.next();
      }
    };
    form.addEventListener('keydown', this.onStepKey);
    this.onCatChange = function (e) {
      var r = e.target;
      if (r && r.hasAttribute && r.hasAttribute('data-sidonia-cat')) self.setCategory(r.getAttribute('data-sidonia-cat'), true);
    };
    form.addEventListener('change', this.onCatChange);

    var checked = form.querySelector('input[data-sidonia-cat]:checked');
    if (!checked) {
      var pre = '';
      try {
        pre = (new URLSearchParams(location.search).get('categoria') || '').toLowerCase().trim();
      } catch (e) {}
      if (pre && /^[a-z0-9-]{2,40}$/.test(pre)) {
        var match = form.querySelector('input[data-sidonia-cat][data-slug="' + pre + '"], input[data-sidonia-cat="' + pre + '"]');
        if (match) {
          match.checked = true;
          checked = match;
        }
      }
    }
    this.setCategory(checked ? checked.getAttribute('data-sidonia-cat') : '', false);
    this.show(1, false);
  };

  Controller.prototype.setCategory = function (key, announce) {
    var previous = this.category;
    this.category = key;
    this.groups.forEach(function (g) {
      var on = g.getAttribute('data-sidonia-cat-group') === key;
      g.disabled = !on;
      Array.prototype.forEach.call(g.querySelectorAll('[data-sidonia-cat-required]'), function (el) {
        el.required = on;
        if (on) el.setAttribute('aria-required', 'true');
        else {
          el.removeAttribute('aria-required');
          clearError(el);
        }
      });
    });
    if (announce && previous && previous !== key) {
      var names = (S.config.divisions || {});
      S.announce(S.t('stepAnnounce', { step: 1, total: this.steps.length }) + '. ' + (names[key] || ''));
    }
  };

  Controller.prototype.stepEl = function (n) {
    return this.steps[n - 1];
  };

  Controller.prototype.show = function (n, focus) {
    var total = this.steps.length;
    this.current = n;
    this.steps.forEach(function (s, i) {
      s.classList.toggle('is-current', i + 1 === n);
    });
    if (this.progressText) this.progressText.textContent = S.t('stepAnnounce', { step: n, total: total });
    if (this.progress) {
      Array.prototype.forEach.call(this.progress.querySelectorAll('[data-step]'), function (li) {
        li.classList.toggle('is-done', Number(li.getAttribute('data-step')) <= n);
      });
    }
    if (this.prevBtn) this.prevBtn.hidden = n === 1;
    if (this.nextBtn) this.nextBtn.hidden = n === total;
    if (focus !== false) {
      var legend = this.stepEl(n).querySelector('legend');
      if (legend) {
        legend.setAttribute('tabindex', '-1');
        legend.focus({ preventScroll: true });
      }
      // La cabecera fija del tema tapa la parte superior: se compara con su altura (scroll-margin-top en el CSS)
      var sticky = parseFloat(getComputedStyle(this.root).scrollMarginTop) || 0;
      var top = this.root.getBoundingClientRect().top;
      if (top < sticky) this.root.scrollIntoView({ behavior: S.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      S.announce(S.t('stepAnnounce', { step: n, total: total }));
    }
  };

  Controller.prototype.next = function () {
    var step = this.stepEl(this.current);
    var errors = this.validate(step);
    var slot = step.querySelector('[data-sidonia-step-error]');
    if (slot) {
      slot.textContent = '';
      slot.hidden = true;
    }
    if (errors.length) {
      if (this.current === 1 && slot) {
        slot.textContent = S.t('chooseCategory');
        slot.hidden = false;
        errors[0].el.focus();
        S.announce(S.t('chooseCategory'));
      } else {
        this.showErrors(errors);
      }
      return;
    }
    if (this.current < this.steps.length) this.show(this.current + 1, true);
  };

  Controller.prototype.prev = function () {
    if (this.current > 1) this.show(this.current - 1, true);
  };

  /* ---------------- arranque idempotente (también tras recargas de secciones del editor) ---------------- */
  function init(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('[data-sidonia-form]'), function (root) {
      if (root.__sidonia) return;
      root.__sidonia = new Controller(root);
    });
  }
  S.initForms = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () {
    init();
  });
  else init();
  document.addEventListener('shopify:section:load', function (e) {
    init(e.target);
  });
})();
