/* LankaLens password-policy UX + persistent email verification dialog. */
(function () {
  'use strict';

  var POLICY_MESSAGE = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a symbol.';

  function passwordValid(value) {
    value = value || '';
    return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9\s]/.test(value);
  }

  function apiBase() {
    var explicit = window.LL_API_BASE;
    if (!explicit) {
      var meta = document.querySelector('meta[name="ll-api-base"]');
      if (meta) explicit = meta.getAttribute('content');
    }
    if (!explicit) {
      try { explicit = window.sessionStorage.getItem('ll_api_base'); } catch (ignore) { /* ignore */ }
    }
    return String(explicit || '/api').replace(/\/+$/, '');
  }

  function authToken() {
    try {
      return (window.sessionStorage.getItem('ll_token') || window.localStorage.getItem('ll_token') || '').trim();
    } catch (ignore) {
      return '';
    }
  }

  function request(path, method, body, token) {
    var headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    token = token || authToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(apiBase() + path, {
      method: method || 'GET',
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (ignore) { payload = null; }
        if (!res.ok || !payload || payload.ok === false) {
          throw new Error((payload && (payload.error || payload.message)) || 'That did not work. Please try again.');
        }
        return payload.data;
      });
    });
  }

  function formError(form, message) {
    var box = form && form.querySelector('.form-error');
    if (box) {
      box.textContent = message || '';
      box.style.display = message ? 'block' : '';
    }
  }

  function setPending(form, pending, text) {
    var button = form && form.querySelector('button[type="submit"]');
    if (!button) return;
    if (!button.getAttribute('data-auth-original-label')) {
      button.setAttribute('data-auth-original-label', button.textContent || 'Submit');
    }
    button.disabled = !!pending;
    button.textContent = pending ? text : button.getAttribute('data-auth-original-label');
  }

  function addPolicyHint(input) {
    if (!input || input.getAttribute('data-password-policy-ready') === '1') return;
    input.setAttribute('data-password-policy-ready', '1');
    input.setAttribute('minlength', '8');
    input.minLength = 8;
    if (input.id === 'su-password' || input.id === 'rp-password') {
      input.setAttribute('placeholder', '8+ characters with A-z, number & symbol');
    }
    if (input.name === 'new' && input.closest('#pw-form')) {
      input.setAttribute('placeholder', '8+ characters with A-z, number & symbol');
    }
    var group = input.closest('.form-group');
    if (group && !group.querySelector('[data-password-policy-hint]')) {
      var hint = document.createElement('div');
      hint.className = 'form-hint';
      hint.setAttribute('data-password-policy-hint', '1');
      hint.textContent = 'Minimum 8 characters: uppercase, lowercase, number and symbol.';
      group.appendChild(hint);
    }
  }

  function enhancePasswordFields() {
    var selectors = [
      '#signup-form input[name="password"]',
      '#reset-form input[name="password"]',
      '#reset-form input[name="confirm"]',
      '#pw-form input[name="new"]'
    ];
    selectors.forEach(function (selector) {
      var input = document.querySelector(selector);
      if (input) addPolicyHint(input);
    });
  }

  function signupType(form) {
    var active = form.querySelector('#stype-seg .opt.active');
    return active && active.getAttribute('data-stype') === 'business' ? 'business' : 'individual';
  }

  function safeSignupDestination(form) {
    if (signupType(form) === 'business') return '#/my-shop';
    var hash = window.location.hash || '#/';
    var q = hash.indexOf('?');
    if (q !== -1) {
      try {
        var next = new URLSearchParams(hash.slice(q + 1)).get('next') || '';
        if (next.indexOf('#/') === 0) return next;
      } catch (ignore) { /* ignore */ }
    }
    return '#/';
  }

  function currentOtpDestination() {
    var hash = window.location.hash || '#/';
    if (hash.indexOf('#/sign-up') === 0) {
      var form = document.querySelector('#signup-form');
      return form ? safeSignupDestination(form) : '#/';
    }
    if (hash.indexOf('#/settings') === 0) return '#/settings';
    return '#/';
  }

  function navigateAndRefresh(destination) {
    destination = destination || '#/';
    window.location.hash = destination.replace(/^#/, '');
    window.setTimeout(function () { window.location.reload(); }, 0);
  }

  function saveSessionToken(token) {
    if (!token) return;
    try {
      window.sessionStorage.setItem('ll_token', token);
      window.localStorage.removeItem('ll_token');
    } catch (ignore) { /* private-mode safe */ }
  }

  function otpStatus(message, isError) {
    var status = document.querySelector('#dialog-host [data-auth-otp-status]');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = isError ? '#B42318' : 'var(--brand)';
  }

  function renderPersistentOtp(email, destination) {
    var host = document.querySelector('#dialog-host');
    if (!host) return;
    host.setAttribute('data-auth-otp-destination', destination || '#/');
    host.innerHTML =
      '<div class="dialog-mask"><div class="dialog" data-stop>' +
      '<h3>Verify your email</h3><div class="d-body">' +
      '<p>Enter the 6-digit code sent to <b data-auth-otp-email></b>.</p>' +
      '<div class="form-group mt16"><label>Verification code</label>' +
      '<input class="input" id="email-otp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div>' +
      '<p class="form-hint" data-auth-otp-status></p></div>' +
      '<div class="d-actions">' +
      '<button class="btn btn-outline" type="button" data-auth-otp-close>Close</button>' +
      '<button class="btn btn-primary" type="button" data-email-otp-verify>Verify code</button>' +
      '</div></div></div>';
    var emailNode = host.querySelector('[data-auth-otp-email]');
    if (emailNode) emailNode.textContent = email || 'your email';
    var mask = host.querySelector('.dialog-mask');
    if (mask) window.requestAnimationFrame(function () { mask.classList.add('open'); });
    var input = host.querySelector('#email-otp-code');
    if (input) input.focus();
  }

  function hardenExistingOtpDialog() {
    var host = document.querySelector('#dialog-host');
    if (!host) return;
    var dialog = host.querySelector('.dialog');
    if (!dialog) return;
    var title = dialog.querySelector('h3');
    if (!title || (title.textContent || '').trim().toLowerCase() !== 'verify your email') return;

    // Tapping the dark backdrop must never dismiss an email-verification code.
    var mask = host.querySelector('.dialog-mask');
    if (mask) mask.removeAttribute('data-dialog-cancel');

    // The stock dialog closes before its callback runs. Replace only this OTP
    // button so invalid/expired codes leave the same dialog visible.
    var ok = dialog.querySelector('[data-dialog-ok]');
    if (ok) {
      ok.removeAttribute('data-dialog-ok');
      ok.setAttribute('data-email-otp-verify', '1');
    }
    if (!dialog.querySelector('[data-auth-otp-status]')) {
      var status = document.createElement('p');
      status.className = 'form-hint';
      status.setAttribute('data-auth-otp-status', '1');
      var body = dialog.querySelector('.d-body');
      if (body) body.appendChild(status);
    }
  }

  function verifyVisibleOtp(button) {
    var input = document.querySelector('#dialog-host #email-otp-code');
    var code = input ? (input.value || '').trim() : '';
    if (!/^\d{6}$/.test(code)) {
      otpStatus('Enter the 6-digit verification code.', true);
      if (input) input.focus();
      return;
    }
    button.disabled = true;
    otpStatus('Verifying…', false);
    request('/auth/verify-email', 'POST', { code: code }).then(function () {
      otpStatus('Email verified.', false);
      var host = document.querySelector('#dialog-host');
      var destination = host && host.getAttribute('data-auth-otp-destination');
      if (!destination) destination = currentOtpDestination();
      if (host) host.innerHTML = '';
      navigateAndRefresh(destination);
    }).catch(function (err) {
      button.disabled = false;
      otpStatus(err.message, true);
      if (input) input.focus();
    });
  }

  function submitShortSignup(form, password) {
    var name = (form.querySelector('[name="name"]').value || '').trim();
    var email = (form.querySelector('[name="email"]').value || '').trim().toLowerCase();
    var phoneInput = form.querySelector('[name="phone"]');
    var phone = phoneInput ? (phoneInput.value || '').trim() : '';
    var type = signupType(form);
    var destination = safeSignupDestination(form);

    formError(form, '');
    setPending(form, true, 'Creating account…');
    request('/auth/signup', 'POST', {
      name: name,
      email: email,
      phone: phone,
      password: password,
      seller_type: type
    }, '').then(function (data) {
      setPending(form, false, '');
      saveSessionToken(data.token);
      if (data.verification_sent) {
        renderPersistentOtp(email, destination);
      } else {
        formError(form, 'Account created, but the verification email could not be sent. You can request another code after signing in.');
        window.setTimeout(function () { navigateAndRefresh(destination); }, 1200);
      }
    }).catch(function (err) {
      setPending(form, false, '');
      formError(form, err.message);
    });
  }

  function resetTokenFromHash() {
    var hash = window.location.hash || '';
    var q = hash.indexOf('?');
    if (q === -1) return '';
    try { return new URLSearchParams(hash.slice(q + 1)).get('token') || ''; } catch (ignore) { return ''; }
  }

  function submitShortReset(form, password) {
    var token = resetTokenFromHash();
    if (!token) {
      formError(form, 'This reset link is missing its token. Request a new one.');
      return;
    }
    setPending(form, true, 'Resetting…');
    request('/auth/reset', 'POST', { token: token, password: password }, '').then(function () {
      setPending(form, false, '');
      window.location.hash = '#/sign-in';
    }).catch(function (err) {
      setPending(form, false, '');
      formError(form, err.message);
    });
  }

  // Capture submit before app.js's form listeners. We only take over the two
  // legacy forms when a valid new-policy password is shorter than the old
  // 12-character client check; otherwise the normal app flow continues.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.id) return;

    if (form.id === 'signup-form') {
      var signupPassword = form.querySelector('[name="password"]');
      var signupValue = signupPassword ? signupPassword.value || '' : '';
      if (!passwordValid(signupValue)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        formError(form, POLICY_MESSAGE);
        if (signupPassword) signupPassword.focus();
        return;
      }
      if (signupValue.length < 12) {
        event.preventDefault();
        event.stopImmediatePropagation();
        submitShortSignup(form, signupValue);
      }
      return;
    }

    if (form.id === 'reset-form') {
      var resetPassword = form.querySelector('[name="password"]');
      var confirm = form.querySelector('[name="confirm"]');
      var resetValue = resetPassword ? resetPassword.value || '' : '';
      if (!passwordValid(resetValue)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        formError(form, POLICY_MESSAGE);
        if (resetPassword) resetPassword.focus();
        return;
      }
      if (confirm && resetValue !== (confirm.value || '')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        formError(form, 'Passwords do not match.');
        confirm.focus();
        return;
      }
      if (resetValue.length < 12) {
        event.preventDefault();
        event.stopImmediatePropagation();
        submitShortReset(form, resetValue);
      }
      return;
    }

    if (form.id === 'pw-form') {
      var newPassword = form.querySelector('[name="new"]');
      var newValue = newPassword ? newPassword.value || '' : '';
      if (!passwordValid(newValue)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.alert(POLICY_MESSAGE);
        if (newPassword) newPassword.focus();
      }
    }
  }, true);

  // Capture OTP actions before the generic app.js dialog delegation.
  document.addEventListener('click', function (event) {
    var verify = event.target && event.target.closest ? event.target.closest('[data-email-otp-verify]') : null;
    if (verify) {
      event.preventDefault();
      event.stopImmediatePropagation();
      verifyVisibleOtp(verify);
      return;
    }

    var close = event.target && event.target.closest ? event.target.closest('[data-auth-otp-close]') : null;
    if (close) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var host = document.querySelector('#dialog-host');
      var destination = host && host.getAttribute('data-auth-otp-destination');
      if (host) host.innerHTML = '';
      navigateAndRefresh(destination || currentOtpDestination());
    }
  }, true);

  var scheduled = false;
  function enhanceSoon() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      enhancePasswordFields();
      hardenExistingOtpDialog();
    }, 0);
  }

  document.addEventListener('DOMContentLoaded', enhanceSoon);
  window.addEventListener('hashchange', enhanceSoon);
  new MutationObserver(enhanceSoon).observe(document.documentElement, { childList: true, subtree: true });
  enhanceSoon();
}());
