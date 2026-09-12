/* Sign in / register / forgot / reset / verify pages */
(function () {
  const LL = window.LL;
  const { esc } = LL;

  LL.controllers = LL.controllers || {};
  LL.controllers.auth = async function (page) {
    const el = page.el;
    const c = el.querySelector('[data-container]');
    const router = LL.f7.views.main.router;
    const path = page.route.path;
    const query = page.route.query || {};
    const next = query.next ? decodeURIComponent(query.next) : null;

    const goAhead = () => router.navigate(next || '/', { reloadCurrent: true, ignoreCache: true });

    if (path.includes('verify-email')) {
      const token = query.token || '';
      c.innerHTML = `<div class="ll-wrap" style="padding:30px 0 60px">
        <div class="auth-card">
          <h2>Verify your email</h2>
          <p class="ll-muted">Paste the verification link/token from the email we sent you.</p>
          <input class="ll-input" id="token" value="${esc(token)}" placeholder="Verification token">
          <button class="button" id="go" style="width:100%;margin-top:12px">Verify email</button>
          <p id="msg" class="ll-tiny" style="margin-top:10px"></p>
        </div></div>`;
      LL.setNavTitle('Verify email');
      const go = async () => {
        const btn = c.querySelector('#go');
        btn.classList.add('button-loading');
        try {
          await LL.api.post('/auth/verify-email', { token: c.querySelector('#token').value.trim() });
          await LL.store.loadMe();
          LL.toast('Email verified — thank you!', 'checkmark-circle');
          goAhead();
        } catch (e) { LL.toastError(e); }
        btn.classList.remove('button-loading');
      };
      c.querySelector('#go').addEventListener('click', go);
      if (token) go();
      return;
    }

    if (path.includes('reset-password')) {
      c.innerHTML = `<div class="ll-wrap" style="padding:30px 0 60px">
        <div class="auth-card">
          <h2>Choose a new password</h2>
          <input class="ll-input" id="token" type="hidden" value="${esc(query.token || '')}">
          <label class="ll-label">New password (min 8 characters)</label>
          <input class="ll-input" id="pw" type="password" placeholder="New password">
          <button class="button" id="go" style="width:100%;margin-top:12px">Reset password</button>
          <p style="margin-top:12px"><a href="/sign-in" data-role="link">Back to sign in</a></p>
        </div></div>`;
      c.querySelector('#go').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('button-loading');
        try {
          await LL.api.post('/auth/reset-password', { token: c.querySelector('#token').value, password: c.querySelector('#pw').value });
          LL.toast('Password updated — please sign in');
          router.navigate('/sign-in/', { reloadCurrent: true });
        } catch (err) { LL.toastError(err); }
        btn.classList.remove('button-loading');
      });
      return;
    }

    if (path.includes('forgot-password')) {
      c.innerHTML = `<div class="ll-wrap" style="padding:30px 0 60px">
        <div class="auth-card">
          <h2>Reset your password</h2>
          <p class="ll-muted ll-tiny">Enter your account email and we will send a reset link. In development, emails appear in the admin outbox.</p>
          <input class="ll-input" id="email" type="email" placeholder="you@example.com">
          <button class="button" id="go" style="width:100%;margin-top:12px">Send reset link</button>
          <p style="margin-top:12px"><a href="/sign-in" data-role="link">Back to sign in</a></p>
        </div></div>`;
      c.querySelector('#go').addEventListener('click', async (e) => {
        await LL.withLoading(e.currentTarget, async () => {
          try {
            const r = await LL.api.post('/auth/forgot-password', { email: c.querySelector('#email').value.trim() });
            LL.toast(r.message || 'Reset link sent');
          } catch (err) { LL.toastError(err); }
        });
      });
      return;
    }

    const mode = path.includes('sign-up') ? 'register' : 'login';
    c.innerHTML = `<div class="ll-wrap" style="padding:24px 0 60px">
      <div class="auth-card">
        <div class="auth-tabs">
          <a class="${mode === 'login' ? 'active' : ''}" href="/sign-in" data-role="link">Sign in</a>
          <a class="${mode === 'register' ? 'active' : ''}" href="/sign-up" data-role="link">Create account</a>
        </div>

        <form id="login-form" ${mode === 'login' ? '' : 'hidden'}>
          <label class="ll-label">Email</label>
          <input class="ll-input" id="li-email" type="email" autocomplete="username" placeholder="you@example.com">
          <label class="ll-label">Password</label>
          <input class="ll-input" id="li-pw" type="password" autocomplete="current-password" placeholder="Your password">
          <div class="ll-flex" style="justify-content:space-between;margin:6px 2px 14px">
            <label class="ll-switch ll-tiny"><input type="checkbox" id="li-remember" checked><span>Keep me signed in</span></label>
            <a href="/forgot-password" data-role="link" class="ll-tiny">Forgot password?</a>
          </div>
          <button type="button" class="button" style="width:100%" id="li-go">Sign in</button>
          <div class="demo-hint">
            <b>Demo accounts</b>
            <span>buyer@lankalens.lk / buyer12345</span>
            <span>seller@lankalens.lk / seller12345</span>
            <span>shop@lankalens.lk / shop12345</span>
            <span>admin@lankalens.lk / admin12345</span>
          </div>
        </form>

        <form id="reg-form" ${mode === 'register' ? '' : 'hidden'}>
          <label class="ll-label">Your name</label>
          <input class="ll-input" id="rg-name" placeholder="e.g. Kasun Perera">
          <label class="ll-label">Email</label>
          <input class="ll-input" id="rg-email" type="email" placeholder="you@example.com">
          <label class="ll-label">Phone (optional)</label>
          <input class="ll-input" id="rg-phone" type="tel" placeholder="077 123 4567">
          <label class="ll-label">Password (min 8 characters)</label>
          <input class="ll-input" id="rg-pw" type="password" placeholder="Create a password">
          <label class="ll-switch ll-tiny" style="margin:10px 0"><input type="checkbox" id="rg-terms" checked><span>I agree to the <a href="/terms" data-role="link">Terms</a> and <a href="/privacy" data-role="link">Privacy Policy</a></span></label>
          <button type="button" class="button" style="width:100%" id="rg-go">Create account</button>
          <p class="ll-tiny ll-muted" style="text-align:center;margin-top:10px">Free to join and post listings.</p>
        </form>
      </div>
      <div class="auth-side">
        <h3>Sell your gear with confidence</h3>
        <ul class="ll-tick">
          <li>Category-specific listing fields for cameras, lenses, action cams and drones</li>
          <li>Verified phone, email and camera-shop badges</li>
          <li>Chat and offers built in — share numbers only when you choose</li>
        </ul>
      </div>
    </div>`;
    LL.setNavTitle(mode === 'login' ? 'Sign in' : 'Create account');

    c.querySelector('#li-go').addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.classList.add('button-loading');
      try {
        await LL.api.post('/auth/login', { email: c.querySelector('#li-email').value.trim(), password: c.querySelector('#li-pw').value });
        await LL.store.loadMe();
        LL.paintBadges();
        goAhead();
      } catch (err) { LL.toastError(err); btn.classList.remove('button-loading'); }
    });
    c.querySelector('#rg-go').addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      if (!c.querySelector('#rg-terms').checked) return LL.toast('Please accept the Terms and Privacy Policy', 'alert-circle-outline');
      btn.classList.add('button-loading');
      try {
        await LL.api.post('/auth/register', {
          name: c.querySelector('#rg-name').value.trim(),
          email: c.querySelector('#rg-email').value.trim(),
          phone: c.querySelector('#rg-phone').value.trim(),
          password: c.querySelector('#rg-pw').value,
        });
        await LL.store.loadMe();
        LL.toast('Welcome to Lanka Lens! Please verify your email.');
        goAhead();
      } catch (err) { LL.toastError(err); btn.classList.remove('button-loading'); }
    });
  };
})();
