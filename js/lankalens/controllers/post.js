/* Multi-step Post Ad wizard (spec §19, §25) with client-side compression. */
(function () {
  const LL = window.LL;
  const { esc, money, avatarHtml } = LL;

  const GROUPS = {
    cameras: { icon: 'camera-outline', label: 'Cameras', hint: 'DSLR, mirrorless, compact, cinema…' },
    lenses: { icon: 'scan-outline', label: 'Lenses', hint: 'Prime, zoom, all mounts' },
    'action-cameras': { icon: 'videocam-outline', label: 'Action Cameras', hint: 'GoPro, DJI Action, Insta360…' },
    drones: { icon: 'rocket-outline', label: 'Drones', hint: 'DJI Mini / Air / Mavic, Autel…' },
    accessories: { icon: 'bag-handle-outline', label: 'Accessories', hint: 'Bags, flashes, tripods, batteries…' },
  };

  const FIELD_SETS = {
    camera: [
      { k: 'year', label: 'Year', type: 'number' },
      { k: 'shutter_count', label: 'Shutter count', type: 'number', placeholder: 'e.g. 18500 (use menu info if available)' },
      { k: 'sensor', label: 'Sensor size', type: 'select', options: ['Full Frame', 'APS-C', 'Micro Four Thirds', 'Medium Format', '1-inch', 'Compact'] },
      { k: 'megapixels', label: 'Megapixels', type: 'number', step: '0.1', placeholder: 'e.g. 24.2' },
      { k: 'video_resolution', label: 'Video resolution', type: 'select', options: ['8K', '6K', '4K', 'Full HD 1080p', 'HD 720p', 'None'] },
      { k: 'iso_range', label: 'ISO range', type: 'text', placeholder: 'e.g. 100–32,000' },
      { k: 'kit', label: 'Body only / with kit lens', type: 'select', options: ['Body only', 'With kit lens'] },
      { k: 'lens_included', label: 'Lens included', type: 'select', options: ['No', 'Yes'] },
      { k: 'battery_included', label: 'Battery included', type: 'select', options: ['Yes', 'No'] },
      { k: 'charger_included', label: 'Charger included', type: 'select', options: ['Yes', 'No'] },
      { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    ],
    lens: [
      { k: 'mount', label: 'Mount', type: 'select', options: ['Canon EF', 'Canon RF', 'Nikon F', 'Nikon Z', 'Sony E', 'Fujifilm X', 'Fujifilm G', 'Micro Four Thirds', 'L-Mount', 'Pentax K', 'Other'] },
      { k: 'focal_length', label: 'Focal length', type: 'text', placeholder: 'e.g. 24-70mm or 50mm' },
      { k: 'max_aperture', label: 'Maximum aperture', type: 'text', placeholder: 'e.g. f/2.8 or f/1.8' },
      { k: 'image_stabilization', label: 'Image stabilization', type: 'select', options: ['Yes', 'No'] },
      { k: 'autofocus', label: 'Focus type', type: 'select', options: ['Autofocus', 'Manual focus only'] },
      { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    ],
    action: [
      { k: 'resolution', label: 'Max video resolution', type: 'select', options: ['5.3K', '4K', '2.7K', 'Full HD 1080p'] },
      { k: 'accessories_included', label: 'Accessories included', type: 'text', placeholder: 'mounts, case, cables…' },
      { k: 'battery_count', label: 'Number of batteries', type: 'number' },
      { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    ],
    drone: [
      { k: 'flight_time', label: 'Flight time per battery (min)', type: 'number' },
      { k: 'camera_resolution', label: 'Camera resolution', type: 'text', placeholder: 'e.g. 4K/60fps, 48MP' },
      { k: 'battery_count', label: 'Number of batteries', type: 'number' },
      { k: 'controller_included', label: 'Controller included', type: 'select', options: ['Yes', 'No', 'RC-N1', 'DJI RC', 'DJI RC 2'] },
      { k: 'accessories', label: 'Accessories included', type: 'text', placeholder: 'propellers, case, ND filters…' },
      { k: 'registration_info', label: 'Registration information (optional)', type: 'text', placeholder: 'Registered with Civil Aviation Authority?' },
      { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    ],
    accessory: [
      { k: 'brand', label: 'Brand', type: 'text', placeholder: 'e.g. Manfrotto, Godox' },
      { k: 'model', label: 'Model', type: 'text' },
      { k: 'compatibility', label: 'Compatibility', type: 'text', placeholder: 'e.g. GoPro mount, Sony E, universal' },
      { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    ],
  };

  const STEPS = ['Category', 'Type', 'Brand', 'Basics', 'Specifications', 'Photos', 'Location', 'Contact', 'Details', 'Review'];

  function processImageFile(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('Please choose image files only.'));
      if (file.size > 12 * 1024 * 1024) return reject(new Error(`${file.name} is over 12MB.`));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = (size) => {
          const ratio = Math.min(1, size / Math.max(img.width, img.height));
          return { w: Math.round(img.width * ratio), h: Math.round(img.height * ratio) };
        };
        const draw = ({ w, h }, q) => new Promise((res) => {
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          const wantWebp = cv.toDataURL('image/webp').indexOf('image/webp') === 5;
          cv.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.readAsDataURL(blob);
          }, wantWebp ? 'image/webp' : 'image/jpeg', q);
        });
        Promise.all([draw(scale(maxSize), quality), draw(scale(700), 0.78)]).then(([full, thumb]) => {
          URL.revokeObjectURL(url);
          resolve({ full, thumb, name: file.name });
        });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read ' + file.name)); };
      img.src = url;
    });
  }

  LL.controllers = LL.controllers || {};
  LL.controllers.post = async function (page) {
    const el = page.el;
    const c = el.querySelector('[data-container]');
    await LL.store.ready();
    const router = LL.f7.views.main.router;
    if (!LL.store.me) { LL.store.requireLogin('/post'); c.innerHTML = ''; return; }

    const editId = page.route.query?.edit || null;
    let categories = await LL.store.getCategories();
    let locations = await LL.store.getLocations();
    let catDetail = null;

    const state = {
      step: 0,
      top: null, leaf: null,
      brand: '', model: '',
      title: '', condition: '', price: '', negotiable: true,
      attributes: {},
      images: [],
      location: '', city: '',
      contact_phone: LL.store.me.phone || '', whatsapp_number: '',
      calls_enabled: true, whatsapp_enabled: true, chat_enabled: true,
      warranty: 'No warranty', receipt_available: false, reason_selling: '',
      description: '',
    };
    if (editId) {
      try {
        const { listing: l } = await LL.api.get(`/listings/${editId}`);
        if (l.seller.id !== LL.store.me.id && LL.store.me.role !== 'admin') throw new Error('forbidden');
        state.top = l.category.top; state.leaf = l.category.slug;
        state.brand = l.brand?.name || l.brand?.slug || ''; state.model = l.product?.name || '';
        Object.assign(state, {
          title: l.title, condition: l.condition, price: String(l.price || ''),
          negotiable: l.negotiable, attributes: l.attributes || {},
          images: (l.images || []).map((i) => ({ full: i.url, thumb: i.thumb_url || i.url })),
          location: String(l.location.id), city: l.location.city || '',
          contact_phone: (l.contact.phone || LL.store.me.phone || '').replace('+94', '0'),
          whatsapp_number: (l.contact.whatsapp || '').replace('+94', '0'),
          calls_enabled: l.contact.calls_enabled, whatsapp_enabled: l.contact.whatsapp_enabled, chat_enabled: l.contact.chat_enabled,
          warranty: l.warranty || 'No warranty', receipt_available: !!l.receipt_available,
          reason_selling: l.reason_selling || '', description: l.description || '',
        });
      } catch { LL.toast('Could not load this listing for editing'); router.back(); return; }
    }

    c.innerHTML = `<div class="ll-wrap" style="padding:12px 0 110px">
      <h1 class="page-title">${editId ? 'Edit listing' : 'Post your camera gear'}</h1>
      <div class="wizard-progress"><div class="wp-bar" id="wp-bar"></div></div>
      <div class="ll-tiny ll-muted" style="margin:6px 2px 14px"><span id="wp-step">Step 1</span> of ${STEPS.length} · <span id="wp-name">${STEPS[0]}</span></div>
      <div class="ll-card ll-card-pad wizard-panel" id="w-panel"></div>
      <div class="wizard-nav">
        <button class="button button-outline" id="wz-back" hidden>Back</button>
        <button class="button button-ghost button-sm" id="wz-draft" hidden>Save draft</button>
        <button class="button" id="wz-next">Continue</button>
      </div>
      <div class="ll-tiny ll-muted" style="text-align:center;margin-top:10px">Free to post · Typically reviewed within a few hours · No commission in MVP</div>
    </div>`;

    const panel = c.querySelector('#w-panel');
    const nextBtn = c.querySelector('#wz-next');
    const backBtn = c.querySelector('#wz-back');
    const draftBtn = c.querySelector('#wz-draft');

    const topNode = () => categories.find((x) => x.slug === state.top);
    const leafNode = () => topNode()?.children.find((x) => x.slug === state.leaf);
    const groupKey = () => ({ cameras: 'camera', lenses: 'lens', 'action-cameras': 'action', drones: 'drone', accessories: 'accessory' }[state.top]);

    function updateChrome() {
      const pct = (state.step / (STEPS.length - 1)) * 100;
      c.querySelector('#wp-bar').style.width = pct + '%';
      c.querySelector('#wp-step').textContent = `Step ${state.step + 1}`;
      c.querySelector('#wp-name').textContent = STEPS[state.step];
      backBtn.hidden = state.step === 0;
      draftBtn.hidden = state.step === 0;
      nextBtn.textContent = state.step === STEPS.length - 1 ? (editId ? 'Save changes' : 'Publish listing') : 'Continue';
    }

    const inputField = (f) => {
      const val = state.attributes[f.k] || '';
      if (f.type === 'select') {
        return `<div class="ll-field"><label>${esc(f.label)}</label>
          <select class="ll-input" data-attr="${f.k}"><option value="">Select…</option>
          ${f.options.map((o) => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      }
      return `<div class="ll-field"><label>${esc(f.label)}</label>
        <input class="ll-input" type="${f.type}" step="${f.step || ''}" placeholder="${esc(f.placeholder || '')}" data-attr="${f.k}" value="${esc(val)}"></div>`;
    };

    function render() {
      updateChrome();
      const s = state.step;
      if (s === 0) {
        panel.innerHTML = `<h3>What are you selling?</h3>
        <div class="wizard-cats">${Object.entries(GROUPS).map(([slug, g]) => `
          <button type="button" class="wizard-cat ${state.top === slug ? 'active' : ''}" data-top="${slug}">
            <span class="ct-icon ${state.top === slug ? '' : 'ct-blue'}"><ion-icon name="${g.icon}"></ion-icon></span>
            <b>${g.label}</b><small>${g.hint}</small>
          </button>`).join('')}</div>`;
      } else if (s === 1) {
        const top = topNode();
        panel.innerHTML = `<h3>${esc(top?.name || '')} — choose exact type</h3>
          <div class="ll-chips" style="flex-wrap:wrap">
            ${top.children.map((sub) => `<button type="button" class="chip ${state.leaf === sub.slug ? 'chip-active' : ''}" data-leaf="${sub.slug}">${esc(sub.name)}</button>`).join('')}
          </div>
          ${state.leaf ? `<div class="alert-banner pending" style="margin-top:14px"><ion-icon name="checkmark-circle"></ion-icon><span>${esc(leafNode()?.name || '')} selected</span></div>` : ''}`;
      } else if (s === 2) {
        const brands = catDetail?.brands || [];
        const products = catDetail?.products || [];
        if (state.top === 'accessories') {
          panel.innerHTML = `<h3>Brand &amp; model</h3>
            <div class="ll-field"><label>Brand</label><input class="ll-input" id="wz-brand" value="${esc(state.attributes.brand || '')}" placeholder="e.g. Manfrotto, Godox, SmallRig"></div>
            <div class="ll-field"><label>Model</label><input class="ll-input" id="wz-model" value="${esc(state.attributes.model || '')}"></div>
            <p class="ll-tiny ll-muted">Accessories use free-text brand/model — fill what you know.</p>`;
        } else {
          panel.innerHTML = `<h3>Brand &amp; model</h3>
            <div class="ll-field"><label>Brand</label>
              <input class="ll-input" list="brand-list" id="wz-brand" value="${esc(state.brand)}" placeholder="Start typing or choose" autocomplete="off">
              <datalist id="brand-list">${brands.map((b) => `<option value="${esc(b.name)}"></option>`).join('')}</datalist>
              <small class="ll-tiny ll-muted">Pick your brand from the list where possible — unknown brands can be typed.</small>
            </div>
            <div class="ll-field"><label>Model</label>
              <input class="ll-input" list="model-list" id="wz-model" value="${esc(state.model)}" placeholder="Pick the exact model">
              <datalist id="model-list">${products.map((p) => `<option value="${p.name}">`).join('')}</datalist>
            </div>`;
        }
      } else if (s === 3) {
        panel.innerHTML = `<h3>The basics</h3>
          <div class="ll-field"><label>Title <span style="color:var(--ll-red)">*</span></label>
            <input class="ll-input" id="wz-title" maxlength="140" value="${esc(state.title)}" placeholder="e.g. Sony A7 III body — 18,500 shots, boxed with receipt">
            <small class="ll-tiny ll-muted">Include brand, model and what's included. ${140 - state.title.length} chars left.</small>
          </div>
          <div class="ll-field"><label>Condition <span style="color:var(--ll-red)">*</span></label>
            <div class="ll-chips">${LL.CONDITIONS.map((x) => `<button type="button" class="chip ${state.condition === x.key ? 'chip-active' : ''}" data-cond="${x.key}">${x.label}</button>`).join('')}</div>
            <small class="ll-tiny ll-muted" id="cond-hint">Be honest — buyers test everything in person.</small>
          </div>
          <div class="ll-field"><label>Price (Rs.) <span style="color:var(--ll-red)">*</span></label>
            <input class="ll-input" id="wz-price" type="number" inputmode="numeric" min="0" step="100" value="${esc(state.price)}" placeholder="e.g. 350000"></div>
          <label class="ll-switch"><input type="checkbox" id="wz-negotiable" ${state.negotiable ? 'checked' : ''}><span>Open to negotiation</span></label>`;
      } else if (s === 4) {
        const fields = FIELD_SETS[groupKey()] || [];
        panel.innerHTML = `<h3>${esc(leafNode()?.name || 'Specifications')} details</h3>
          <p class="ll-tiny ll-muted">Fill what you know — accurate details help buyers and reduce time-wasters.</p>
          ${fields.map(inputField).join('')}
          <div class="ll-field"><label>Included in the sale (other items)</label>
            <textarea class="ll-textarea" id="wz-included" rows="2" placeholder="e.g. extra straps, screen protector, SD card">${esc(state.attributes.included_items || '')}</textarea></div>`;
      } else if (s === 5) {
        panel.innerHTML = `<h3>Photos</h3>
          <p class="ll-tiny ll-muted">Add up to 10 clear photos — the first photo is the cover. Photos are compressed on your device.</p>
          <label class="photo-add" id="wz-photoadd">
            <input type="file" id="wz-photoinput" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden>
            <ion-icon name="camera-outline"></ion-icon>
            <b>Add photos</b>
            <small>JPG / PNG / WebP · max 12MB each</small>
          </label>
          <div id="wz-photostatus" class="ll-tiny ll-muted"></div>
          <div class="photo-grid" id="wz-photogrid"></div>`;
        renderPhotos();
      } else if (s === 6) {
        panel.innerHTML = `<h3>Where is the item?</h3>
          <div class="ll-field"><label>Province</label><select class="ll-input" id="wz-prov"><option value="">Select province</option>${locations.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
          <div class="ll-field"><label>District</label><select class="ll-input" id="wz-dist" disabled><option value="">Select district</option></select></div>
          <div class="ll-field"><label>City / town</label><select class="ll-input" id="wz-city" disabled><option value="">Select city</option></select></div>
          <small class="ll-tiny ll-muted">Meet buyers in a busy public place (mall, bank, police station area).</small>`;
        wireLocation();
      } else if (s === 7) {
        panel.innerHTML = `<h3>How should buyers contact you?</h3>
          <div class="ll-field"><label>Phone number (for calls)</label>
            <input class="ll-input" id="wz-phone" type="tel" value="${esc(state.contact_phone)}" placeholder="077 123 4567 or +94771234567"></div>
          <div class="ll-field"><label>WhatsApp number</label>
            <input class="ll-input" id="wz-wa" type="tel" value="${esc(state.whatsapp_number)}" placeholder="Leave blank to use phone number"></div>
          <div style="margin-top:8px">
            <label class="ll-switch"><input type="checkbox" id="ch-call" ${state.calls_enabled ? 'checked' : ''}><span>Allow phone calls</span></label>
            <label class="ll-switch"><input type="checkbox" id="ch-wa" ${state.whatsapp_enabled ? 'checked' : ''}><span>Allow WhatsApp messages</span></label>
            <label class="ll-switch"><input type="checkbox" id="ch-chat" ${state.chat_enabled ? 'checked' : ''}><span>Allow in-app chat</span></label>
          </div>
          <div class="alert-banner pending" style="margin-top:12px"><ion-icon name="lock-closed-outline"></ion-icon><span>Numbers are only revealed on the listing when you enable the channel. Your WhatsApp link is generated per listing.</span></div>`;
      } else if (s === 8) {
        const wopts = ['No warranty', 'Shop warranty', 'Manufacturer warranty', 'Under warranty (months remaining)', 'DJI Care Refresh'];
        panel.innerHTML = `<h3>Description &amp; extras</h3>
          <div class="ll-field"><label>Description <span style="color:var(--ll-red)">*</span></label>
            <textarea class="ll-textarea" id="wz-desc" rows="7" maxlength="8000" placeholder="Condition details, usage, shutter count history, what's included, known issues (be honest — buyers check), reason for selling.">${esc(state.description)}</textarea></div>
          <div class="ll-field"><label>Warranty</label>
            <select class="ll-input" id="wz-warranty">${wopts.map((o) => `<option ${state.warranty === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <label class="ll-switch"><input type="checkbox" id="wz-receipt" ${state.receipt_available ? 'checked' : ''}><span>I have the purchase receipt</span></label>
          <div class="ll-field" style="margin-top:10px"><label>Reason for selling</label>
            <input class="ll-input" id="wz-reason" maxlength="300" value="${esc(state.reason_selling)}" placeholder="e.g. upgrading to full frame"></div>`;
      } else if (s === 9) {
        renderReview();
      }
      panel.scrollTop = 0;
    }

    function renderPhotos() {
      const grid = c.querySelector('#wz-photogrid');
      if (!grid) return;
      grid.innerHTML = state.images.map((im, i) => `
        <div class="photo-thumb" draggable="true" data-i="${i}">
          <img src="${im.thumb || im.full}" alt="">
          ${i === 0 ? '<span class="pt-cover">Cover</span>' : `<span class="pt-order">#${i + 1}</span>`}
          <div class="pt-actions">
            <button type="button" data-move="-1" ${i === 0 ? 'disabled' : ''}><ion-icon name="chevron-back"></ion-icon></button>
            <button type="button" data-move="1" ${i === state.images.length - 1 ? 'disabled' : ''}><ion-icon name="chevron-forward"></ion-icon></button>
            <button type="button" data-del="${i}"><ion-icon name="trash-outline"></ion-icon></button>
          </div>
        </div>`).join('');
      grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { state.images.splice(Number(b.dataset.del), 1); renderPhotos(); }));
      grid.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.closest('.photo-thumb').dataset.i), d = Number(b.dataset.move);
        const j = i + d;
        if (j < 0 || j >= state.images.length) return;
        [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
        renderPhotos();
      }));
      grid.querySelectorAll('.photo-thumb').forEach((t) => {
        t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.dataset.i); });
        t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('drag-over'); });
        t.addEventListener('dragleave', () => t.classList.remove('drag-over'));
        t.addEventListener('drop', (e) => {
          e.preventDefault(); t.classList.remove('drag-over');
          const from = Number(e.dataTransfer.getData('text/plain'));
          const to = Number(t.dataset.i);
          const [m] = state.images.splice(from, 1);
          state.images.splice(to, 0, m);
          renderPhotos();
        });
      });
    }

    function wireLocation() {
      const p = panel.querySelector('#wz-prov'), d = panel.querySelector('#wz-dist'), ct = panel.querySelector('#wz-city');
      const fillD = (pid, selD) => {
        const prov = locations.find((x) => x.id === Number(pid));
        d.innerHTML = '<option value="">Select district</option>' + (prov?.children || []).map((x) => `<option value="${x.id}" ${String(x.id) === String(selD || '') ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
        d.disabled = !prov;
      };
      const fillC = (did, selC) => {
        let cities = [];
        for (const prov of locations) for (const dd of prov.children || []) if (dd.id === Number(did)) cities = dd.children || [];
        ct.innerHTML = '<option value="">Select city</option>' + cities.map((x) => `<option value="${x.id}" ${String(x.id) === String(selC || '') ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
        ct.disabled = !cities.length;
      };
      if (state.location) {
        const lid = Number(state.location);
        for (const prov of locations) {
          if (prov.id === lid) { p.value = prov.id; break; }
          for (const dd of prov.children || []) {
            if (dd.id === lid) { p.value = prov.id; fillD(prov.id, dd.id); break; }
            for (const cc of dd.children || []) if (cc.id === lid) { p.value = prov.id; fillD(prov.id, dd.id); fillC(dd.id, cc.id); }
          }
        }
      }
      p.addEventListener('change', () => { fillD(p.value); ct.innerHTML = '<option value="">Select city</option>'; ct.disabled = true; state.location = p.value; });
      d.addEventListener('change', () => { fillC(d.value); state.location = d.value || p.value; });
      ct.addEventListener('change', () => { state.location = ct.value || d.value || p.value; state.city = ct.options[ct.selectedIndex]?.textContent || ''; });
    }

    function gatherStep() {
      const s = state.step;
      if (s === 2) {
        if (state.top === 'accessories') {
          state.attributes.brand = panel.querySelector('#wz-brand').value.trim();
          state.attributes.model = panel.querySelector('#wz-model').value.trim();
          state.brand = ''; state.model = '';
        } else {
          const rawBrand = panel.querySelector('#wz-brand').value.trim();
          const match = (catDetail?.brands || []).find((x) => x.name.toLowerCase() === rawBrand.toLowerCase() || x.slug === rawBrand.toLowerCase());
          state.brand = match ? match.slug : rawBrand; // backend also resolves friendly names
          const rawModel = panel.querySelector('#wz-model').value.trim();
          const pm = (catDetail?.products || []).find((x) => x.name.toLowerCase() === rawModel.toLowerCase() || x.slug === rawModel.toLowerCase());
          state.model = pm ? pm.name : rawModel;
        }
      } else if (s === 3) {
        state.title = panel.querySelector('#wz-title').value.trim();
        state.price = panel.querySelector('#wz-price').value.trim();
        state.negotiable = panel.querySelector('#wz-negotiable').checked;
      } else if (s === 4) {
        panel.querySelectorAll('[data-attr]').forEach((i) => { const v = i.value.trim(); if (v) state.attributes[i.dataset.attr] = v; else delete state.attributes[i.dataset.attr]; });
        const inc = panel.querySelector('#wz-included');
        if (inc) { const v = inc.value.trim(); if (v) state.attributes.included_items = v; else delete state.attributes.included_items; }
      } else if (s === 7) {
        state.contact_phone = panel.querySelector('#wz-phone').value.trim();
        state.whatsapp_number = panel.querySelector('#wz-wa').value.trim();
        state.calls_enabled = panel.querySelector('#ch-call').checked;
        state.whatsapp_enabled = panel.querySelector('#ch-wa').checked;
        state.chat_enabled = panel.querySelector('#ch-chat').checked;
      } else if (s === 8) {
        state.description = panel.querySelector('#wz-desc').value.trim();
        state.warranty = panel.querySelector('#wz-warranty').value;
        state.receipt_available = panel.querySelector('#wz-receipt').checked;
        state.reason_selling = panel.querySelector('#wz-reason').value.trim();
      }
    }

    function validateStep() {
      const s = state.step;
      if (s === 0 && !state.top) return 'Choose a category.';
      if (s === 1 && !state.leaf) return 'Choose the exact item type.';
      if (s === 3) {
        if (!state.title || state.title.length < 8) return 'Write a clear title (at least 8 characters).';
        if (!state.condition) return 'Choose the condition.';
        if (!state.price || Number(state.price) < 0) return 'Enter a price (use 0 only if giving away).';
      }
      if (s === 5 && !state.images.length) return 'Add at least one photo.';
      if (s === 6 && !state.location) return 'Choose your location.';
      if (s === 7) {
        if (!state.calls_enabled && !state.whatsapp_enabled && !state.chat_enabled) return 'Enable at least one contact method.';
        if ((state.calls_enabled || state.whatsapp_enabled) && !state.contact_phone && !state.whatsapp_number) return 'Enter a phone or WhatsApp number.';
      }
      if (s === 8 && state.description.length < 20) return 'Add a useful description (at least 20 characters).';
      return null;
    }

    async function loadCatDetail() {
      try { catDetail = await LL.api.get(`/categories/${state.leaf}`); } catch { catDetail = null; }
    }

    function renderReview() {
      const img = state.images[0]?.thumb || state.images[0]?.full;
      const attrs = state.attributes;
      const specHtml = Object.entries(attrs).filter(([k]) => k !== 'included_items').map(([k, v]) =>
        `<div class="spec-row"><span>${esc(k.replace(/_/g, ' '))}</span><b>${esc(v)}</b></div>`).join('');
      const locPath = (() => {
        const lid = Number(state.location);
        for (const p of locations) for (const d of p.children || []) for (const cc of d.children || []) if (cc.id === lid) return `${cc.name}, ${d.name}`;
        for (const p of locations) for (const d of p.children || []) if (d.id === lid) return d.name;
        for (const p of locations) if (p.id === lid) return p.name;
        return '';
      })();
      panel.innerHTML = `<h3>Review &amp; publish</h3>
        <div class="preview-card">
          <div class="pc-img">${img ? `<img src="${img}">` : '<ion-icon name="image-outline"></ion-icon>'}</div>
          <div class="pc-body">
            <h4>${esc(state.title || 'Untitled listing')}</h4>
            <div class="pc-price">${money(state.price || 0)} ${state.negotiable ? '<small>· negotiable</small>' : ''}</div>
            <div>${LL.conditionPill(state.condition)}</div>
            <div class="ll-tiny ll-muted" style="margin-top:6px">${esc(leafNode()?.name || '')} · ${esc(locPath)}</div>
          </div>
        </div>
        <div class="preview-section">
          <h5>Photos (${state.images.length})</h5>
          <div class="photo-grid">${state.images.map((im) => `<div class="photo-thumb" style="cursor:default"><img src="${im.thumb || im.full}"></div>`).join('')}</div>
        </div>
        <div class="preview-section"><h5>Specifications</h5><div class="spec-list">${specHtml || '<p class="ll-muted ll-tiny">None added</p>'}</div></div>
        <div class="preview-section"><h5>Description</h5><p style="white-space:pre-wrap">${esc(state.description)}</p></div>
        <div class="preview-section">
          <h5>Contact</h5>
          <p class="ll-tiny">${state.calls_enabled ? 'Calls: ' + esc(state.contact_phone) + '<br>' : ''}${state.whatsapp_enabled ? 'WhatsApp: ' + esc(state.whatsapp_number || state.contact_phone) + '<br>' : ''}${state.chat_enabled ? 'In-app chat enabled' : ''}</p>
        </div>
        <div class="preview-section"><h5>Extras</h5>
          <p class="ll-tiny">${esc(state.warranty)} · Receipt: ${state.receipt_available ? 'yes' : 'no'}${state.reason_selling ? ' · Reason: ' + esc(state.reason_selling) : ''}</p></div>
        <div class="alert-banner pending"><ion-icon name="time-outline"></ion-icon><span>After publishing your listing enters a short approval review. You can edit or pause it anytime from My Listings.</span></div>`;
    }

    function buildPayload() {
      const payload = {
        category: state.leaf,
        title: state.title, description: state.description, price: Number(state.price || 0),
        condition: state.condition, location: Number(state.location), city: state.city,
        brand: state.brand, model: state.model,
        attributes: state.attributes,
        negotiable: state.negotiable,
        warranty: state.warranty, receipt_available: state.receipt_available,
        reason_selling: state.reason_selling,
        contact_phone: state.contact_phone, whatsapp_number: state.whatsapp_number || state.contact_phone,
        calls_enabled: state.calls_enabled, whatsapp_enabled: state.whatsapp_enabled, chat_enabled: state.chat_enabled,
        images: state.images,
      };
      return payload;
    }

    async function submit(status) {
      const payload = buildPayload();
      if (status === 'draft') payload.status = 'draft';
      nextBtn.classList.add('button-loading');
      try {
        let res;
        if (editId) {
          res = await LL.api.patch(`/listings/${editId}`, payload);
          LL.toast('Listing updated');
        } else {
          res = await LL.api.post('/listings', payload);
          LL.toast(res.message || (status === 'draft' ? 'Draft saved' : 'Listing submitted'));
        }
        const l = res.listing;
        c.innerHTML = `<div class="ll-wrap" style="padding:40px 0">
          <div class="ll-empty" style="padding-top:20px">
            <div class="ee-icon" style="background:var(--ll-teal-soft);color:var(--ll-teal)"><ion-icon name="checkmark-done-circle"></ion-icon></div>
            <h3>${status === 'draft' ? 'Draft saved' : (l.status === 'active' ? 'Your listing is live!' : 'Submitted for review')}</h3>
            <p>${status === 'draft' ? 'Finish and publish it whenever you like from My Listings.' : (l.status === 'active' ? 'Share it and wait for buyer messages.' : 'Most listings are approved within a few hours. We will notify you.')}</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
              ${l.status === 'active' ? `<a class="button" href="/listing/${l.slug}" data-role="link">View listing</a>` : ''}
              <a class="button button-outline" href="/my-listings" data-role="link">My listings</a>
              <a class="button button-ghost" href="/" data-role="link">Back home</a>
            </div>
          </div></div>`;
      } catch (e) {
        LL.toastError(e);
        nextBtn.classList.remove('button-loading');
      }
    }

    /* ---------------- events ---------------- */
    panel.addEventListener('click', (e) => {
      const top = e.target.closest('[data-top]');
      if (top) { state.top = top.dataset.top; state.leaf = null; state.brand = ''; state.model = ''; catDetail = null; render(); return; }
      const leaf = e.target.closest('[data-leaf]');
      if (leaf) { state.leaf = leaf.dataset.leaf; render(); return; }
      const cond = e.target.closest('[data-cond]');
      if (cond) {
        gatherStep(); // preserve anything already typed on the basics step
        state.condition = cond.dataset.cond;
        render();
        const h = c.querySelector('#cond-hint'); if (h) h.textContent = LL.CONDITIONS.find((x) => x.key === state.condition)?.hint;
      }
    });

    const photoInput = () => c.querySelector('#wz-photoinput');
    panel.addEventListener('change', (e) => {
      if (e.target.id === 'wz-photoinput') {
        const files = [...e.target.files];
        const status = c.querySelector('#wz-photostatus');
        (async () => {
          for (const f of files) {
            if (state.images.length >= 10) { LL.toast('Maximum 10 photos'); break; }
            status.textContent = `Processing ${f.name}…`;
            try { state.images.push(await processImageFile(f, 1600, 0.82)); renderPhotos(); }
            catch (err) { LL.toastError(err); }
          }
          status.textContent = state.images.length ? `${state.images.length} photo(s) ready` : '';
          e.target.value = '';
        })();
      }
    });

    backBtn.addEventListener('click', () => { gatherStep(); state.step--; render(); });
    draftBtn.addEventListener('click', () => {
      gatherStep();
      if (!state.leaf || !state.title) return LL.toast('Choose a category and add a title before saving a draft', 'alert-circle-outline');
      submit('draft');
    });
    nextBtn.addEventListener('click', async () => {
      gatherStep();
      const err = validateStep();
      if (err) return LL.toast(err, 'alert-circle-outline');
      if (state.step === 1) await loadCatDetail();
      if (state.step === 2 && state.brand && state.model && catDetail?.brands?.length) {
        // validate brand slug: map friendly name input
        const b = catDetail.brands.find((x) => x.name.toLowerCase() === state.brand.toLowerCase() || x.slug === state.brand.toLowerCase());
        if (b) state.brand = b.slug;
      }
      if (state.step < STEPS.length - 1) { state.step++; render(); }
      else submit('publish');
    });

    render();
    LL.setMeta({ title: editId ? 'Edit listing' : 'Post an Ad', description: 'Sell your camera, lens, action cam, drone or accessory on Lanka Lens.' });
  };
})();
