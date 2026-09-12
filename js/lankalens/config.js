/* Global Lanka Lens constants — mirror server category groups. */
window.LL = window.LL || {};
LL.CONDITIONS = [
  { key: 'brand_new', label: 'Brand New', hint: 'Sealed or never used', cls: 'brand_new' },
  { key: 'like_new', label: 'Like New', hint: 'Barely used, boxed', cls: 'like_new' },
  { key: 'excellent', label: 'Excellent', hint: 'Minor cosmetic marks, fully working', cls: 'excellent' },
  { key: 'good', label: 'Good', hint: 'Clear signs of use, works perfectly', cls: 'good' },
  { key: 'fair', label: 'Fair', hint: 'Heavy use, functional with wear', cls: 'fair' },
  { key: 'parts', label: 'For Parts / Repair', hint: 'Not fully working', cls: 'parts' },
];
LL.CONDITION_LABELS = Object.fromEntries(LL.CONDITIONS.map((c) => [c.key, c.label]));

LL.TOP_CATEGORIES = [
  { slug: 'cameras', label: 'Cameras', icon: 'camera-outline', cls: 'ct-blue' },
  { slug: 'lenses', label: 'Lenses', icon: 'scan-outline', cls: 'ct-purple' },
  { slug: 'action-cameras', label: 'Action Cameras', icon: 'videocam-outline', cls: 'ct-orange' },
  { slug: 'drones', label: 'Drones', icon: 'rocket-outline', cls: 'ct-green' },
  { slug: 'accessories', label: 'Accessories', icon: 'bag-handle-outline', cls: 'ct-brown' },
];

LL.REPORT_REASONS = [
  { key: 'scam', label: 'Suspected scam' },
  { key: 'fake_product', label: 'Fake product / counterfeit' },
  { key: 'wrong_information', label: 'Wrong or misleading information' },
  { key: 'duplicate', label: 'Duplicate listing' },
  { key: 'wrong_category', label: 'Wrong category' },
  { key: 'prohibited', label: 'Prohibited item' },
  { key: 'offensive', label: 'Offensive content' },
  { key: 'other', label: 'Other' },
];

LL.RESOLUTIONS = [
  { key: '5.3K', label: '5.3K' }, { key: '4K', label: '4K' },
  { key: '2.7K', label: '2.7K' }, { key: 'Full HD 1080p', label: '1080p' },
];
