'use strict';
// Master camera catalog: category tree, brand lists per subcategory,
// canonical product/models, filter definitions and posting-form attributes.

const FILTERS = {
  camera: [
    { k: 'brand', label: 'Brand', type: 'select-brand' },
    { k: 'condition', label: 'Condition', type: 'select-condition' },
    { k: 'price_min', label: 'Min price (Rs.)', type: 'number' },
    { k: 'price_max', label: 'Max price (Rs.)', type: 'number' },
    { k: 'shutter_max', label: 'Max shutter count', type: 'number' },
    { k: 'megapixels_min', label: 'Min megapixels', type: 'number' },
    { k: 'location', label: 'Location', type: 'select-location' },
    { k: 'seller_type', label: 'Seller type', type: 'select-seller' },
  ],
  lens: [
    { k: 'brand', label: 'Brand', type: 'select-brand' },
    { k: 'mount', label: 'Mount', type: 'select-mount' },
    { k: 'focal', label: 'Focal length', type: 'select-focal' },
    { k: 'aperture', label: 'Max aperture', type: 'select-aperture' },
    { k: 'condition', label: 'Condition', type: 'select-condition' },
    { k: 'price_min', label: 'Min price (Rs.)', type: 'number' },
    { k: 'price_max', label: 'Max price (Rs.)', type: 'number' },
    { k: 'location', label: 'Location', type: 'select-location' },
    { k: 'seller_type', label: 'Seller type', type: 'select-seller' },
  ],
  action: [
    { k: 'brand', label: 'Brand', type: 'select-brand' },
    { k: 'condition', label: 'Condition', type: 'select-condition' },
    { k: 'resolution', label: 'Max video resolution', type: 'select-resolution' },
    { k: 'price_min', label: 'Min price (Rs.)', type: 'number' },
    { k: 'price_max', label: 'Max price (Rs.)', type: 'number' },
    { k: 'location', label: 'Location', type: 'select-location' },
    { k: 'seller_type', label: 'Seller type', type: 'select-seller' },
  ],
  drone: [
    { k: 'brand', label: 'Brand', type: 'select-brand' },
    { k: 'condition', label: 'Condition', type: 'select-condition' },
    { k: 'flight_min', label: 'Min flight time (min)', type: 'number' },
    { k: 'batteries_min', label: 'Min batteries', type: 'number' },
    { k: 'price_min', label: 'Min price (Rs.)', type: 'number' },
    { k: 'price_max', label: 'Max price (Rs.)', type: 'number' },
    { k: 'location', label: 'Location', type: 'select-location' },
    { k: 'seller_type', label: 'Seller type', type: 'select-seller' },
  ],
  accessory: [
    { k: 'brand', label: 'Brand', type: 'select-brand' },
    { k: 'condition', label: 'Condition', type: 'select-condition' },
    { k: 'price_min', label: 'Min price (Rs.)', type: 'number' },
    { k: 'price_max', label: 'Max price (Rs.)', type: 'number' },
    { k: 'location', label: 'Location', type: 'select-location' },
    { k: 'seller_type', label: 'Seller type', type: 'select-seller' },
  ],
};

// Category-specific posting fields (spec section 10)
const ATTRS = {
  camera: [
    { k: 'year', label: 'Year', type: 'number' },
    { k: 'shutter_count', label: 'Shutter count', type: 'number' },
    { k: 'sensor', label: 'Sensor', type: 'select', options: ['Full Frame', 'APS-C', 'Micro Four Thirds', 'Medium Format', '1-inch', 'Compact'] },
    { k: 'megapixels', label: 'Megapixels', type: 'number', step: '0.1' },
    { k: 'video_resolution', label: 'Video resolution', type: 'select', options: ['4K', '6K', '8K', 'Full HD 1080p', 'HD 720p', 'None'] },
    { k: 'iso_range', label: 'ISO range', type: 'text', placeholder: 'e.g. 100–32,000' },
    { k: 'kit', label: 'Body only / kit', type: 'select', options: ['Body only', 'With kit lens'] },
    { k: 'lens_included', label: 'Lens included', type: 'select', options: ['No', 'Yes'] },
    { k: 'battery_included', label: 'Battery included', type: 'select', options: ['Yes', 'No'] },
    { k: 'charger_included', label: 'Charger included', type: 'select', options: ['Yes', 'No'] },
    { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    { k: 'warranty', label: 'Warranty', type: 'select', options: ['No warranty', 'Shop warranty', 'Manufacturer warranty', 'Under warranty (months remaining)'] },
    { k: 'receipt_available', label: 'Receipt available', type: 'select', options: ['Yes', 'No'] },
  ],
  lens: [
    { k: 'mount', label: 'Mount', type: 'select', options: ['Canon EF', 'Canon RF', 'Nikon F', 'Nikon Z', 'Sony E', 'Fujifilm X', 'Fujifilm G', 'Micro Four Thirds', 'L-Mount', 'Pentax K', 'Other'] },
    { k: 'focal_length', label: 'Focal length', type: 'text', placeholder: 'e.g. 24-70mm or 50mm' },
    { k: 'max_aperture', label: 'Maximum aperture', type: 'text', placeholder: 'e.g. f/2.8 or f/1.8' },
    { k: 'image_stabilization', label: 'Image stabilization', type: 'select', options: ['Yes', 'No'] },
    { k: 'autofocus', label: 'Autofocus', type: 'select', options: ['Autofocus', 'Manual focus only'] },
    { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    { k: 'warranty', label: 'Warranty', type: 'select', options: ['No warranty', 'Shop warranty', 'Manufacturer warranty'] },
    { k: 'receipt_available', label: 'Receipt available', type: 'select', options: ['Yes', 'No'] },
  ],
  action: [
    { k: 'resolution', label: 'Max video resolution', type: 'select', options: ['5.3K', '4K', '2.7K', 'Full HD 1080p'] },
    { k: 'accessories_included', label: 'Accessories included', type: 'text', placeholder: 'mounts, case, cables…' },
    { k: 'battery_count', label: 'Battery count', type: 'number' },
    { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    { k: 'warranty', label: 'Warranty', type: 'select', options: ['No warranty', 'Shop warranty', 'Manufacturer warranty'] },
    { k: 'receipt_available', label: 'Receipt available', type: 'select', options: ['Yes', 'No'] },
  ],
  drone: [
    { k: 'flight_time', label: 'Flight time per battery (min)', type: 'number' },
    { k: 'camera_resolution', label: 'Camera resolution', type: 'text', placeholder: 'e.g. 4K/60fps 48MP' },
    { k: 'battery_count', label: 'Battery count', type: 'number' },
    { k: 'controller_included', label: 'Controller included', type: 'select', options: ['Yes', 'No', 'RC-N1', 'DJI RC', 'DJI RC 2'] },
    { k: 'accessories', label: 'Accessories included', type: 'text', placeholder: 'propellers, case, ND filters…' },
    { k: 'registration_info', label: 'Registration information', type: 'text', placeholder: 'Registered with Civil Aviation Authority? (optional)' },
    { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    { k: 'warranty', label: 'Warranty', type: 'select', options: ['No warranty', 'Shop warranty', 'DJI Care Refresh', 'Manufacturer warranty'] },
    { k: 'receipt_available', label: 'Receipt available', type: 'select', options: ['Yes', 'No'] },
  ],
  accessory: [
    { k: 'brand', label: 'Brand', type: 'text' },
    { k: 'model', label: 'Model', type: 'text' },
    { k: 'compatibility', label: 'Compatibility', type: 'text', placeholder: 'e.g. GoPro mount, Sony E, universal' },
    { k: 'original_box', label: 'Original box', type: 'select', options: ['Yes', 'No'] },
    { k: 'warranty', label: 'Warranty', type: 'select', options: ['No warranty', 'Shop warranty', 'Manufacturer warranty'] },
    { k: 'receipt_available', label: 'Receipt available', type: 'select', options: ['Yes', 'No'] },
  ],
};

const C = (
  name, slug, icon, color, group, subs // subs: [name, slug, [brands], {Brand: [models]}]
) => ({ name, slug, icon, color, group, subs });

const catalog = [
  {
    name: 'Cameras', slug: 'cameras', icon: 'camera-outline', color: 'blue', group: 'camera',
    filters: FILTERS.camera, attrs: ATTRS.camera,
    subs: [
      ['DSLR Cameras', 'dslr', ['Canon', 'Nikon', 'Sony', 'Pentax', 'Other'], {
        Canon: ['EOS 90D', 'EOS 80D', 'EOS 77D', 'EOS 7D Mark II', 'EOS 5D Mark IV', 'EOS 6D Mark II', 'EOS 250D', 'EOS 200D II', 'EOS 4000D'],
        Nikon: ['D850', 'D750', 'D780', 'D7500', 'D5600', 'D3500', 'D610'],
        Sony: ['Alpha A68', 'Alpha A99 II'],
        Pentax: ['K-70', 'K-1 Mark II', 'KF'],
        Other: ['Other DSLR'],
      }],
      ['Mirrorless Cameras', 'mirrorless', ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Panasonic', 'OM System', 'Leica', 'Other'], {
        Sony: ['A7 III', 'A7 II', 'A7 IV', 'A7R III', 'A7R IV', 'A7R V', 'A6400', 'A6000', 'A6600', 'A6700', 'ZV-E10', 'FX30'],
        Canon: ['EOS R6', 'EOS R6 Mark II', 'EOS R5', 'EOS R', 'EOS RP', 'EOS R7', 'EOS R10', 'EOS R50', 'EOS M50 Mark II'],
        Nikon: ['Z6 II', 'Z7 II', 'Z5', 'Z50', 'Zfc', 'Z30', 'Z9', 'Z8'],
        Fujifilm: ['X-T4', 'X-T5', 'X-T3', 'X-T30 II', 'X-S10', 'X-S20', 'X100V', 'X100VI', 'X-E4'],
        Panasonic: ['Lumix S5', 'Lumix S5 II', 'Lumix GH5', 'Lumix GH6', 'Lumix G85', 'Lumix G95'],
        'OM System': ['OM-1', 'OM-5', 'OM-D E-M10 Mark IV', 'OM-D E-M1 Mark III'],
        Leica: ['Q2', 'Q3', 'M11', 'SL2'],
        Other: ['Other Mirrorless'],
      }],
      ['Compact Cameras', 'compact', ['Sony', 'Canon', 'Panasonic', 'Fujifilm', 'Ricoh', 'Other'], {
        Sony: ['Cyber-shot RX100 VII', 'Cyber-shot RX100 III', 'ZV-1'],
        Canon: ['PowerShot G7 X Mark III', 'PowerShot G5 X Mark II'],
        Panasonic: ['Lumix LX10', 'Lumix TZ220'],
        Fujifilm: ['XF10'],
        Ricoh: ['GR III', 'GR IIIx'],
        Other: ['Other Compact'],
      }],
      ['Cinema Cameras', 'cinema', ['Sony', 'Canon', 'Blackmagic', 'Panasonic', 'Other'], {
        Sony: ['FX3', 'FX6', 'FX30', 'PXW-Z150'],
        Canon: ['EOS C70', 'EOS R5 C', 'XA60'],
        Blackmagic: ['Pocket Cinema Camera 4K', 'Pocket Cinema Camera 6K', 'Pocket Cinema Camera 6K Pro'],
        Panasonic: ['Lumix GH6', 'Lumix S1H'],
        Other: ['Other Cinema Camera'],
      }],
      ['Medium Format', 'medium-format', ['Fujifilm', 'Hasselblad', 'Leica', 'Pentax', 'Other'], {
        Fujifilm: ['GFX 50S II', 'GFX 100S', 'GFX 100 II'],
        Hasselblad: ['X2D 100C', 'X1D II 50C'],
        Leica: ['S3'],
        Pentax: ['645Z'],
        Other: ['Other Medium Format'],
      }],
      ['Other Cameras', 'other-cameras', ['Other'], { Other: ['Other camera'] }],
    ],
  },
  {
    name: 'Lenses', slug: 'lenses', icon: 'scan-outline', color: 'purple', group: 'lens',
    filters: FILTERS.lens, attrs: ATTRS.lens,
    subs: [
      ['Canon EF', 'canon-ef', ['Canon', 'Sigma', 'Tamron', 'Tokina', 'Samyang', 'Other'], {
        Canon: ['EF 50mm f/1.8 STM', 'EF 50mm f/1.4 USM', 'EF 24-70mm f/2.8L II USM', 'EF 24-105mm f/4L IS USM', 'EF 70-200mm f/2.8L IS III USM', 'EF 70-200mm f/4L IS USM', 'EF 85mm f/1.8 USM', 'EF 100mm f/2.8 Macro IS USM'],
        Sigma: ['24-70mm f/2.8 DG OS HSM Art', '35mm f/1.4 DG HSM Art', '18-35mm f/1.8 DC HSM Art'],
        Tamron: ['SP 24-70mm f/2.8 Di VC USD G2', 'SP 70-200mm f/2.8 Di VC USD G2', '18-400mm f/3.5-6.3 Di II VC HLD'],
        Tokina: ['atx-i 11-16mm f/2.8 CF', 'atx-i 100mm f/2.8 FF Macro'],
        Samyang: ['35mm f/1.4 AS UMC', '14mm f/2.8 IF ED UMC'],
        Other: ['Other Canon EF lens'],
      }],
      ['Canon RF', 'canon-rf', ['Canon', 'Sigma', 'Tamron', 'Other'], {
        Canon: ['RF 50mm f/1.8 STM', 'RF 50mm f/1.2L USM', 'RF 24-105mm f/4L IS USM', 'RF 24-105mm f/2.8L IS USM Z', 'RF 35mm f/1.8 Macro IS STM', 'RF 85mm f/2 Macro IS STM', 'RF 100-400mm f/5.6-8 IS USM'],
        Sigma: ['35mm f/1.4 DG DN Art (RF)', '18-50mm f/2.8 DC DN (RF)'],
        Other: ['Other Canon RF lens'],
      }],
      ['Nikon F', 'nikon-f', ['Nikon', 'Sigma', 'Tamron', 'Tokina', 'Samyang', 'Other'], {
        Nikon: ['AF-S 50mm f/1.8G', 'AF-P 18-55mm f/3.5-5.6G VR', 'AF-S 24-120mm f/4G ED VR', 'AF-S 70-200mm f/2.8E FL ED VR', 'AF-S 105mm f/2.8G Macro'],
        Sigma: ['35mm f/1.4 DG HSM Art (F)', '17-50mm f/2.8 EX DC OS HSM'],
        Tamron: ['SP 24-70mm f/2.8 Di VC USD G2 (F)', '18-400mm f/3.5-6.3 Di II VC HLD (F)'],
        Tokina: ['atx-i 11-16mm f/2.8 CF (F)'],
        Samyang: ['14mm f/2.8 IF ED UMC (F)'],
        Other: ['Other Nikon F lens'],
      }],
      ['Nikon Z', 'nikon-z', ['Nikon', 'Other'], {
        Nikon: ['NIKKOR Z 24-70mm f/4 S', 'NIKKOR Z 24-70mm f/2.8 S', 'NIKKOR Z 50mm f/1.8 S', 'NIKKOR Z 35mm f/1.8 S', 'NIKKOR Z 85mm f/1.8 S', 'NIKKOR Z DX 16-50mm f/3.5-6.3 VR', 'NIKKOR Z DX 50-250mm f/4.5-6.3 VR'],
        Other: ['Other Nikon Z lens'],
      }],
      ['Sony E', 'sony-e', ['Sony', 'Sigma', 'Tamron', 'Samyang', 'Tokina', 'Other'], {
        Sony: ['FE 50mm f/1.8', 'FE 35mm f/1.8', 'FE 24-70mm f/2.8 GM', 'FE 24-70mm f/2.8 GM II', 'FE 24-105mm f/4 G OSS', 'FE 70-200mm f/2.8 GM OSS II', 'FE 85mm f/1.8', 'E 15-55mm f/3.5-5.6 OSS', 'E PZ 16-50mm f/3.5-5.6 OSS'],
        Sigma: ['24-70mm f/2.8 DG DN Art', '35mm f/1.4 DG DN Art', '18-50mm f/2.8 DC DN Contemporary', '56mm f/1.4 DC DN Contemporary', '16mm f/1.4 DC DN Contemporary'],
        Tamron: ['28-75mm f/2.8 Di III VXD G2', '70-180mm f/2.8 Di III VXD', '17-70mm f/2.8 Di III-A VC', '35-150mm f/2-2.8 Di III VXD'],
        Samyang: ['AF 35mm f/1.4 FE', 'AF 45mm f/1.8 FE', 'AF 12mm f/2 E'],
        Tokina: ['atx-m 33mm f/1.4 E', 'atx-m 23mm f/1.4 E'],
        Other: ['Other Sony E lens'],
      }],
      ['Fujifilm X', 'fujifilm-x', ['Fujifilm', 'Sigma', 'Samyang', 'Other'], {
        Fujifilm: ['XF 35mm f/1.4 R', 'XF 35mm f/2 R WR', 'XF 23mm f/2 R WR', 'XF 18-55mm f/2.8-4 R LM OIS', 'XF 16-80mm f/4 R OIS WR', 'XF 55-200mm f/3.5-4.8 R LM OIS', 'XF 50mm f/2 R WR'],
        Sigma: ['30mm f/1.4 DC DN Contemporary (X)', '56mm f/1.4 DC DN Contemporary (X)'],
        Samyang: ['AF 12mm f/2 X'],
        Other: ['Other Fujifilm X lens'],
      }],
      ['Fujifilm G', 'fujifilm-g', ['Fujifilm', 'Other'], {
        Fujifilm: ['GF 35-70mm f/4.5-5.6 WR', 'GF 32-64mm f/4 R LM WR', 'GF 80mm f/1.7 R WR', 'GF 45mm f/2.8 R WR'],
        Other: ['Other Fujifilm G lens'],
      }],
      ['Micro Four Thirds', 'micro-four-thirds', ['Panasonic', 'OM System', 'Olympus', 'Sigma', 'Samyang', 'Other'], {
        Panasonic: ['Lumix G 25mm f/1.7 ASPH', 'Lumix G Vario 14-140mm f/3.5-5.6 II', 'Lumix G 42.5mm f/1.7'],
        'OM System': ['M.Zuiko 45mm f/1.8', 'M.Zuiko 25mm f/1.8', 'M.Zuiko ED 40-150mm f/4 Pro'],
        Olympus: ['M.Zuiko ED 12-40mm f/2.8 Pro'],
        Sigma: ['16mm f/1.4 DC DN Contemporary (MFT)', '30mm f/1.4 DC DN Contemporary (MFT)'],
        Samyang: ['12mm f/2 NCS CS (MFT)'],
        Other: ['Other Micro Four Thirds lens'],
      }],
      ['Sigma', 'sigma', ['Sigma'], { Sigma: ['24-70mm f/2.8 DG DN Art', '150-600mm f/5-6.3 DG DN OS Sports', '105mm f/2.8 DG DN Macro Art', 'Other Sigma lens'] }],
      ['Tamron', 'tamron', ['Tamron'], { Tamron: ['28-75mm f/2.8 Di III VXD G2', '35-150mm f/2-2.8 Di III VXD', '150-500mm f/5-6.7 Di III VC VXD', 'Other Tamron lens'] }],
      ['Tokina', 'tokina', ['Tokina'], { Tokina: ['atx-i 11-16mm f/2.8 CF', 'FiRIN 20mm f/2 FE', 'Other Tokina lens'] }],
      ['Samyang', 'samyang', ['Samyang'], { Samyang: ['AF 35mm f/1.4 FE', 'AF 45mm f/1.8 FE', '14mm f/2.8 IF ED UMC', 'Other Samyang lens'] }],
      ['Other Lenses', 'other-lenses', ['Other'], { Other: ['Other lens'] }],
    ],
  },
  {
    name: 'Action Cameras', slug: 'action-cameras', icon: 'videocam-outline', color: 'orange', group: 'action',
    filters: FILTERS.action, attrs: ATTRS.action,
    subs: [
      ['GoPro', 'gopro', ['GoPro'], {
        GoPro: ['HERO 13 Black', 'HERO 12 Black', 'HERO 11 Black', 'HERO 10 Black', 'HERO 9 Black', 'HERO 8 Black', 'MAX', 'Other GoPro'],
      }],
      ['DJI Action', 'dji-action', ['DJI'], {
        DJI: ['Osmo Action 5 Pro', 'Osmo Action 4', 'Osmo Action 3', 'Osmo Action 2', 'Other DJI Action'],
      }],
      ['Insta360', 'insta360', ['Insta360'], {
        Insta360: ['X4', 'X3', 'GO 3', 'GO 3S', 'Ace Pro 2', 'Ace Pro', 'Ace', 'Other Insta360'],
      }],
      ['Other Action Cameras', 'other-action', ['Other'], { Other: ['Other action camera', 'Akaso action camera', 'SJCam action camera'] }],
    ],
  },
  {
    name: 'Drones', slug: 'drones', icon: 'rocket-outline', color: 'green', group: 'drone',
    filters: FILTERS.drone, attrs: ATTRS.drone,
    subs: [
      ['DJI Drones', 'dji', ['DJI'], {
        DJI: ['Mini 3', 'Mini 3 Pro', 'Mini 4 Pro', 'Mini 2', 'Air 3', 'Air 2S', 'Mavic 3', 'Mavic 3 Classic', 'Mavic 3 Pro', 'Avata 2', 'Avata', 'Neo', 'Other DJI Drone'],
      }],
      ['Autel', 'autel', ['Autel'], {
        Autel: ['EVO Nano+', 'EVO Lite+', 'EVO II Pro', 'Other Autel Drone'],
      }],
      ['Other Drones', 'other-drones', ['Other'], { Other: ['Other drone'] }],
    ],
  },
  {
    name: 'Accessories', slug: 'accessories', icon: 'bag-handle-outline', color: 'brown', group: 'accessory',
    filters: FILTERS.accessory, attrs: ATTRS.accessory,
    subs: [
      ['Tripods', 'tripods', ['Manfrotto', 'Gitzo', 'Peak Design', 'Joby', 'Benro', 'Neewer', 'Other']],
      ['Monopods', 'monopods', ['Manfrotto', 'Benro', 'Other']],
      ['Gimbals', 'gimbals', ['DJI', 'Zhiyun', 'Moza', 'FeiyuTech', 'Hohem', 'Other']],
      ['Camera Bags', 'camera-bags', ['Peak Design', 'Lowepro', 'Case Logic', 'WANDRD', 'PGYTECH', 'Other']],
      ['Memory Cards', 'memory-cards', ['SanDisk', 'Samsung', 'Sony', 'Lexar', 'Kingston', 'Other']],
      ['Batteries', 'batteries', ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic', 'GoPro', 'DJI', 'Other']],
      ['Chargers', 'chargers', ['Canon', 'Nikon', 'Sony', 'GoPro', 'DJI', 'Other']],
      ['Filters', 'filters', ['NiSi', 'Hoya', 'B+W', 'K&F Concept', 'Freewell', 'Tiffen', 'Other']],
      ['Flashes', 'flashes', ['Godox', 'Canon', 'Nikon', 'Sony', 'Profoto', 'Yongnuo', 'Other']],
      ['Microphones', 'microphones', ['Rode', 'DJI', 'Sennheiser', 'Boya', 'Hollyland', 'Comica', 'Other']],
      ['LED Lights', 'led-lights', ['Godox', 'Aputure', 'Amaran', 'Neewer', 'SmallRig', 'Ulanzi', 'Other']],
      ['Camera Straps', 'camera-straps', ['Peak Design', 'BlackRapid', 'Joby', 'Other']],
      ['Cages', 'cages', ['SmallRig', 'Tilta', 'Ulanzi', 'PGYTECH', 'Other']],
      ['Mounts', 'mounts', ['SmallRig', 'Ulanzi', 'PGYTECH', 'Manfrotto', 'Other']],
      ['GoPro Accessories', 'gopro-accessories', ['GoPro', 'PGYTECH', 'SmallRig', 'Other']],
      ['DJI Accessories', 'dji-accessories', ['DJI', 'PGYTECH', 'Other']],
      ['Drone Accessories', 'drone-accessories', ['DJI', 'Autel', 'PGYTECH', 'Freewell', 'Other']],
      ['Selfie Sticks', 'selfie-sticks', ['GoPro', 'DJI', 'Insta360', 'Other']],
      ['Cleaning Kits', 'cleaning-kits', ['Other']],
      ['Other Accessories', 'other-accessories', ['Other']],
    ],
  },
];

module.exports = { catalog, FILTERS, ATTRS };
