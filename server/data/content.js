'use strict';
// Seeded informational pages and camera-guide blog posts (sections 42-44).

const PAGES = {
  about: {
    title: 'About Lanka Lens',
    html: `<p><strong>Lanka Lens is Sri Lanka's dedicated marketplace for cameras and photographic equipment.</strong> We help photographers across the island buy and sell used DSLR and mirrorless cameras, lenses, GoPro and DJI action cameras, drones, gimbals and accessories — alongside selected new stock from verified camera shops.</p>
<h3>Why Lanka Lens exists</h3><p>Generic classified sites bury camera gear among cars, houses and phones, and they don't capture the details that matter to photographers: shutter count, lens mount, aperture, flight time, battery count or box and receipt. Lanka Lens is built around those details so buyers can compare equipment properly and sellers can list it in minutes with category-specific fields.</p>
<h3>How we protect buyers and sellers</h3><ul><li>Phone, email and business verification with visible badges only when verification actually happened.</li><li>Listing moderation before publication.</li><li>Category-specific condition grading: Brand New, Like New, Excellent, Good, Fair, For Parts.</li><li>Built-in messaging, offers, and per-seller WhatsApp/phone contact — your private number stays hidden until you choose to call.</li><li>A practical Safety &amp; Buying Guide and in-app reporting.</li></ul>
<p>Lanka Lens is a marketplace platform. Listings are provided by individual sellers and camera shops; Lanka Lens does not own the equipment, does not take part in payment, and does not guarantee transactions unless a specific guarantee service is explicitly offered on a listing.</p>`,
  },
  safety: {
    title: 'Safety & Scam Prevention',
    html: `<p>Used camera equipment is valuable, which attracts scammers. Follow these rules on every deal — on Lanka Lens or anywhere else online.</p>
<h3>Meet safely</h3><ul><li>Meet in a busy, public, well-lit place — a shopping mall, a known camera shop, or a bank lobby.</li><li>Bring a friend or tell someone exactly where you are going and who you are meeting.</li><li>Inspect during daylight; avoid rushed meetings and last-minute location changes.</li></ul>
<h3>Test before you pay</h3><ul><li><strong>DSLR / mirrorless:</strong> check shutter count, sensor for dust and scratches, all dials, ports, LCD, hot shoe and autofocus with your own lens if possible.</li><li><strong>Lenses:</strong> inspect glass under light for fungus, haze, dust and scratches; test AF, aperture blades, IS/VR and mount fit.</li><li><strong>Action cameras:</strong> record test video, check all buttons, waterproof seal, battery health and included mounts.</li><li><strong>Drones:</strong> fly it, check gimbal calibration, all batteries, obstacle sensors, controller linking and the number of flight hours.</li></ul>
<h3>Verify the paperwork</h3><ul><li>Ask for the original receipt and warranty card; match the serial number on the camera/lens/drone with the box and receipt.</li><li>Search the serial number online and confirm the equipment is not reported stolen.</li><li>For drones, ask about Civil Aviation Authority registration where it applies.</li></ul>
<h3>Payments</h3><ul><li>Never send advance payments or deposits to people you have not met.</li><li>Do not pay via unsecured links, gift cards or foreign "agents".</li><li>Use cash on delivery of goods or a documented bank transfer after inspection.</li><li>Never share OTPs, passwords, card CVV or banking login codes — no real buyer, seller or Lanka Lens staff member will ever ask for them.</li></ul>
<h3>Spot common scams</h3><ul><li>Prices far below market — if it looks too good to be true, it usually is.</li><li>Sellers who refuse a video call, refuse to meet, or only communicate outside the Lanka Lens chat.</li><li>Stock/stolen catalogue photos instead of real photos of the actual item.</li><li>Pressure tactics ("deposit now, three people are coming to buy").</li></ul>
<p>If something feels wrong, use <strong>Report</strong> on the listing or conversation. Our moderation team reviews every report. In an emergency, contact local police.</p>`,
  },
  'buying-guide': {
    title: 'Used Camera Buying Guide (Sri Lanka)',
    html: `<p>A practical checklist for buying used camera gear in Sri Lanka. Work through it in order and you will avoid the vast majority of bad purchases.</p>
<h3>1. Decide the system first</h3><p>Lenses usually outlast bodies, so picking a mount (Canon RF/EF, Nikon Z/F, Sony E, Fujifilm X, Micro Four Thirds) matters more than the body. Buy into a system you can afford to grow.</p>
<h3>2. Check the shutter count</h3><p>Mechanical shutters are rated for a lifespan (e.g. ~100,000–200,000 actuations for enthusiast bodies). Ask the seller for a current shutter-count photo from tools like ShutterCount, Canon DPP, EOS Info, or the camera's EXIF data. A low count in a clean body is ideal; a high count at the right price can still be fine.</p>
<h3>3. Examine the sensor</h3><p>With the lens removed, hold the body with mount facing down and inspect the sensor glass under bright light. Shoot a photo at f/22 of a plain white surface — dust spots show clearly. Minor dust cleans easily; oil streaks or scratches do not.</p>
<h3>4. Test everything</h3><ul><li>Autofocus on near and far subjects, both viewfinder and live view.</li><li>Every dial, button, port (USB/HDMI/mic), flash/hot shoe and the IBIS/OS switch.</li><li>Video at the maximum resolution you intend to use; check overheating and audio.</li><li>Battery health and that the original charger is included.</li></ul>
<h3>5. Inspect lenses</h3><p>Shine a phone torch through the glass from both ends. Reject <strong>fungus</strong> (web-like strands), heavy <strong>haze</strong>, or deep coating scratches. Tiny dust specks are normal. Check aperture blades open/close cleanly, AF motors are silent and quick, and IS/VR hums and stabilises.</p>
<h3>6. Action cameras & drones</h3><p>For GoPro/DJI Action/Insta360: test waterproof seals, all mics, screen touch, and battery; demand the box and receipt. For drones: fly for at least 15 minutes, test RTH (return-to-home), gimbal, every battery cell, obstacle sensors, and confirm the controller and cables are genuine.</p>
<h3>7. Price fairly</h3><p>Compare completed listings, not just asking prices. Factor in shutter count, condition, remaining warranty, box/receipt and included accessories (extra batteries, ND filters, bags add real value). Use <strong>Make an Offer</strong> politely inside chat.</p>
<h3>8. Paperwork</h3><p>Original receipt, warranty card and matching serial numbers are worth paying a small premium for — and make the item easier to resell later.</p>
<p>Read the detailed per-category guides in our blog, and always follow the <a href="#/safety">Safety guide</a>.</p>`,
  },
  sell: {
    title: 'Sell Your Camera',
    html: `<p>Turn unused camera gear into cash. Lanka Lens listings are free, and posting takes about five minutes.</p>
<h3>What sells well</h3><ul><li>DSLR &amp; mirrorless bodies with a known shutter count</li><li>Popular lenses (50mm f/1.8, 24-70mm f/2.8, kit zooms)</li><li>GoPro, DJI Action and Insta360 cameras</li><li>DJI Mini/Air/Mavic drones with batteries and controller</li><li>Tripods, gimbals, flashes, bags, SD cards and cages</li></ul>
<h3>How to list</h3><ol><li>Tap <strong>Post Ad</strong> and choose Camera, Lens, Action Camera, Drone or Accessory.</li><li>Pick the brand and exact model (buyers search by model).</li><li>Fill the category-specific fields — shutter count, mount, flight time, etc.</li><li>Choose an honest condition and a realistic price in rupees.</li><li>Add clear photos: front, back, top, bottom, LCD, lens mount, accessories, box and receipt. Hide the serial number in photos if you prefer.</li><li>Set your location (province, district, city) and contact preferences: chat, phone and WhatsApp.</li><li>Preview and submit. Our team reviews and approves listings, usually within hours.</li></ol>
<h3>Pricing tips</h3><p>Search Lanka Lens for the same model, compare condition and included accessories, and price slightly above your minimum to leave room for offers. Keep the original box and receipt — they measurably increase what buyers will pay.</p>
<h3>Camera shops</h3><p>Registered businesses can open a storefront with logo, opening hours, WhatsApp contact and a shop-level listing catalogue. Apply for business verification from your profile after registering.</p>`,
  },
  privacy: {
    title: 'Privacy Policy',
    html: `<p>This policy explains what personal data Lanka Lens collects and why. It is provided for development/v1 operation and should be reviewed before commercial launch.</p>
<h3>Data we collect</h3><ul><li>Account data: name, email, phone number, hashed password, optional profile photo and location.</li><li>Listing data: listings, photos, attributes and messages you submit.</li><li>Usage data: listing views, searches, favourites, contact clicks and analytics events used to show sellers statistics.</li><li>Technical data: IP addresses and rate-limit counters for abuse prevention.</li></ul>
<h3>How we use it</h3><p>To operate the marketplace, moderate listings, deliver notifications and messages, prevent fraud and abuse, and show sellers anonymised statistics about their listings. We never sell your personal data.</p>
<h3>Phone numbers</h3><p>Your number is used to generate contact links (tel/WhatsApp) only when you enable contact on a listing. You can keep chat-only listings.</p>
<h3>Passwords & security</h3><p>Passwords are stored using bcrypt hashing; we never store or display plaintext passwords. Authentication uses signed, httpOnly cookies.</p>
<h3>Your choices</h3><p>You can edit or delete your listings and account from settings. Deletion removes personal listing data; some audit/anti-fraud records may be retained as required by law.</p>
<h3>Contact</h3><p>Privacy questions: privacy@lankalens.lk (development environment: see the contact page).</p>`,
  },
  terms: {
    title: 'Terms & Conditions',
    html: `<h3>1. The service</h3><p>Lanka Lens provides an online platform for buyers and sellers of camera equipment in Sri Lanka. Lanka Lens is not the seller of listed goods and is not a party to transactions between users unless expressly stated.</p>
<h3>2. Accounts</h3><p>You must provide accurate registration details, keep your password secure, and notify us of unauthorised use. Users must be at least 18 years old.</p>
<h3>3. Listings</h3><p>Listings must describe genuine camera/photography equipment you own or are authorised to sell. Stolen, counterfeit, prohibited or deliberately misleading listings are prohibited. All listings are subject to moderation and may be edited, rejected or removed.</p>
<h3>4. Fees</h3><p>Standard listings are free during v1. Optional paid promotions are clearly shown; no payment is collected until a payment gateway is enabled and you confirm purchase.</p>
<h3>5. Transactions between users</h3><p>Lanka Lens does not handle, escrow or guarantee payments between users in v1. Deal safely (see our Safety guide), inspect goods before paying, and never send advance deposits.</p>
<h3>6. Prohibited conduct</h3><p>Fraud, off-platform circumscription intended to scam, spam, fake reviews, harassment, scraping and attempts to compromise the service are prohibited and may result in suspension and reporting to authorities.</p>
<h3>7. Content</h3><p>You retain ownership of photos and text you upload and grant Lanka Lens a licence to display them on the service for the purpose of operating the marketplace.</p>
<h3>8. Liability</h3><p>The service is provided "as is". To the maximum extent permitted by law, Lanka Lens is not liable for losses arising from user-to-user transactions.</p>`,
  },
  faq: {
    title: 'Frequently Asked Questions',
    html: `<h3>Is Lanka Lens free to use?</h3><p>Yes. Browsing, searching, registering, posting standard listings, favourites and messaging are free. Optional listing promotions will be clearly priced before payment is enabled.</p>
<h3>How do I buy on Lanka Lens?</h3><p>Find the item, check photos and specifications, use Make an Offer or Chat to ask questions, then arrange to meet, inspect and test the gear before paying.</p>
<h3>How do I find the shutter count?</h3><p>Ask the seller, or see our shutter-count guide. Apps and free tools exist for Canon, Nikon, Sony and Fujifilm; newer mirrorless bodies sometimes show it in menus.</p>
<h3>Can I hide my serial number in photos?</h3><p>Yes. You are encouraged to photograph everything, but you may hide or blur the serial number. Be ready to show it in person to a serious buyer.</p>
<h3>What do the condition grades mean?</h3><p><strong>Brand New</strong> sealed/unused; <strong>Like New</strong> barely used with box; <strong>Excellent</strong> minor signs of use, fully working; <strong>Good</strong> clear signs of use; <strong>Fair</strong> heavy use but functional; <strong>For Parts</strong> not fully working.</p>
<h3>How does WhatsApp contact work?</h3><p>The WhatsApp button opens a chat with the seller's configured number and a pre-filled message about that listing. Your number stays yours.</p>
<h3>What is a Verified Seller badge?</h3><p>Badges reflect the verification actually completed: phone-verified, email-verified or business-verified. We never show a badge without the underlying check.</p>
<h3>How long do listings stay active?</h3><p>Sixty (60) days by default; you can renew from My Listings. Sold items should be marked sold.</p>
<h3>I suspect a scam — what now?</h3><p>Tap Report on the listing or chat with the reason, and review the Safety guide. Do not pay and do not continue meeting the seller if anything feels wrong.</p>`,
  },
  help: {
    title: 'Help Center',
    html: `<h3>Getting started</h3><ul><li><a href="#/sign-up">Create an account</a> with email and a Sri Lankan phone number.</li><li>Verify your email using the link sent to you (in development the link is logged / shown in the dev outbox).</li><li>Complete your profile with location.</li></ul>
<h3>Buying</h3><p>Search by brand or model (e.g. "Sony A7 III", "GoPro 12", "DJI Mini 3", "Sigma 24-70"), filter by condition, price and location, favourite items, then chat, offer, call or WhatsApp.</p>
<h3>Selling</h3><p>Use the <a href="#/sell">Sell Your Camera</a> guide and the Post Ad wizard. Wait for moderation approval; you are notified of approval, rejection or change requests.</p>
<h3>Account & listings</h3><p>My Listings has tabs for Active, Pending, Sold, Expired and Drafts, with Edit, Pause, Renew, Mark sold, Promote and Delete actions.</p>
<h3>Still stuck?</h3><p>Visit the <a href="#/contact">Contact</a> page or email support@lankalens.lk (development environment).</p>`,
  },
  contact: {
    title: 'Contact Lanka Lens',
    html: `<p>Questions about a listing, your account, verification or a report? We are happy to help.</p>
<ul><li><strong>Email:</strong> support@lankalens.lk</li><li><strong>Business & shop verification:</strong> shops@lankalens.lk</li><li><strong>Abuse / scams:</strong> use the Report button on any listing or email safety@lankalens.lk</li><li><strong>Hours:</strong> Monday–Saturday, 9:00–18:00 (IST)</li></ul>
<p>For your safety, Lanka Lens staff will never ask for your password or OTP.</p>`,
  },
};

const BLOG = [
  {
    slug: 'how-to-check-a-used-dslr',
    title: 'How to Check a Used DSLR Before Buying',
    excerpt: 'Shutter count, sensor, mirror box, AF points and the tests that actually matter.',
    category: 'Buying Guides',
    html: `<p>Used DSLRs are excellent value, but they have moving parts that wear. Spend 20 minutes on these checks.</p>
<h3>1. Shutter count</h3><p>Ask the seller to provide a shutter actuation count from an unedited JPEG/RAW using free tools. Compare it to the camera's rated shutter life; under 30% used is great, under 60% is fine for the right price.</p>
<h3>2. Sensor and mirror</h3><p>Shoot a white wall at f/22 and inspect for spots. Inspect the sensor and mirror with the lens removed under good light. Dust is normal; scratches, oil or corrosion are not.</p>
<h3>3. Autofocus and lens mount</h3><p>Test AF with both a fast prime and your intended lens, in good and low light, through the viewfinder and live view. Twist the mounted lens gently — a loose mount means hard use.</p>
<h3>4. Buttons, dials, pop-up flash and hot shoe</h3><p>Press everything, change every setting, fire the pop-up flash and trigger an external flash if you have one. Sticky dials are expensive to fix.</p>
<h3>5. Body, ports and battery</h3><p>Check battery door, card door, USB/HDMI ports, strap lugs and rubber grips. Confirm the charger is genuine and the battery holds a charge.</p>
<p>Finish with a test video clip and a long burst. If the seller refuses any test, walk away.</p>`,
  },
  {
    slug: 'checking-used-mirrorless-camera',
    title: 'Buying a Used Mirrorless Camera in Sri Lanka',
    excerpt: 'Sensor checks, EVI lag, IBIS, overheating and what Sony, Canon, Nikon and Fujifilm buyers should test.',
    category: 'Buying Guides',
    html: `<p>Mirrorless cameras have fewer moving parts but more electronics, so the inspection differs from DSLRs.</p>
<h3>Sensor and IBIS</h3><p>Use the f/22 white-wall test for dust. Turn IBIS on and off — it should be silent when active and the image should stabilise in the viewfinder. Rattling when switched off is usually normal (floated sensor).</p>
<h3>Electronic viewfinder and screen</h3><p>Check for dead pixels, burn-in, touch response and the articulating hinges. Check EVF lag in a dark room.</p>
<h3>Video and heat</h3><p>Record 10 minutes at the highest resolution/frame rate you will use. Overheating warnings in a cool room are a red flag in Sri Lankan conditions.</p>
<h3>Autofocus</h3><p>Test eye/face tracking on people and animals if advertised, continuous AF, and low-light hunting. Test each memory-card slot.</p>
<h3>Battery and accessories</h3><p>Mirrorless bodies eat batteries; third-party batteries have reduced life. Prefer listings with the original charger, spare battery, box and receipt.</p>`,
  },
  {
    slug: 'how-to-check-shutter-count',
    title: 'How to Check Camera Shutter Count (Canon, Nikon, Sony, Fujifilm)',
    excerpt: 'Free and paid ways to read actuations, and what counts mean for a used camera’s lifespan.',
    category: 'Technical',
    html: `<p>Shutter count is the camera's odometer. Mechanical shutters are rated by the manufacturer (often 100k–500k actuations).</p>
<h3>Canon</h3><p>Canon hides count in maker notes. Use ShutterCount (Mac/iOS), EOS Info (Windows for some models), or upload an unedited JPEG to CameraShutterCount.com. Newer mirrorless bodies (R series) may not expose it.</p>
<h3>Nikon</h3><p>Nikon embeds the count directly in every JPEG/RAW EXIF — open it in free EXIF viewers or websites and look for "Shutter Count".</p>
<h3>Sony</h3><p>Use the free Sony Shutter Count websites/tools that parse RAW files, or ExifTool (<code>exiftool -ShutterCount file.arw</code>). Some bodies require an unedited ARW.</p>
<h3>Fujifilm</h3><p>Fujifilm does not expose a simple count; sellers can show the image file numbering or use community tools. Focus on physical condition and sensor testing instead.</p>
<h3>Interpreting the number</h3><p>Below 10,000 is essentially new; 10,000–50,000 is light use; 50,000–100,000 is moderate for enthusiast bodies; over 150,000 demands a steep discount on mid-range cameras. Pro bodies are built for 400k+.</p>`,
  },
  {
    slug: 'how-to-check-a-used-lens',
    title: 'How to Inspect a Used Lens: Fungus, Haze, AF and More',
    excerpt: 'A five-minute torch test separates a bargain from a paperweight.',
    category: 'Buying Guides',
    html: `<h3>1. The torch test</h3><p>Remove caps and hood, open the aperture, and shine a phone torch through the rear element at an angle. Look for: <strong>fungus</strong> (white web-like strands — reject), <strong>haze</strong> (uniform fog — usually bad), large dust collections, and chips in the glass.</p>
<h3>2. Coatings and scratches</h3><p>Tiny surface marks on the front element rarely affect images; deep scratches or coating wipe-off (rainbow patches) do.</p>
<h3>3. Aperture blades</h3><p>Stop the lens down with the depth-of-field preview (or test on a body). Blades should snap evenly with no oil — oiled blades mean it will eventually stick.</p>
<h3>4. Focus and stabilisation</h3><p>Test AF speed and accuracy at near and far distances, and AF in low light. Listen for grinding. Toggle stabilisation (IS/VR/OSS) and half-press the shutter — you should hear/feel it engage and see steadier framing.</p>
<h3>5. Mount, zoom and filters</h3><p>Check mount screws for tool marks (service history), rotate zoom and focus rings for even resistance, and test filter threads.</p>
<p>Finally, shoot wide open at f/1.8/f/2.8, stopped down, and against bright light to check flare and centering. Bring your own camera body when meeting sellers.</p>`,
  },
  {
    slug: 'test-used-gopro-action-camera',
    title: 'How to Test a Used GoPro, DJI Action or Insta360',
    excerpt: 'Waterproof seals, batteries, overheating and the accessories fakes get wrong.',
    category: 'Buying Guides',
    html: `<h3>Record before you pay</h3><p>Record at the camera's highest resolution (5.3K/4K) for at least 10 minutes and inspect for overheating shutdowns, artefacts and mic crackle.</p>
<h3>Seals and ports</h3><p>Inspect the rubber door seals and lens glass for scratches. A warped door or replaced non-genuine lens means water damage risk.</p>
<h3>Battery health</h3><p>Swollen batteries are dangerous and common — reject them on sight. Check charge percentage stability over the test recording; rapid drains mean a worn cell.</p>
<h3>Screens and buttons</h3><p>Test touchscreens, every physical button, voice control and pairing with the official phone app.</p>
<h3>DJI Action specifics</h3><p>Test the magnetic mount, RockSteady stabilisation and both front/back screens (Action 4/5 Pro).</p>
<h3>Accessories and fakes</h3><p>Genuine GoPro batteries, the quick-release buckle and mounts are expensive — value them. Counterfeit GoPros exist: verify serial numbers in the GoPro/Quik app where possible and demand the receipt.</p>`,
  },
  {
    slug: 'inspecting-a-used-drone',
    title: 'How to Inspect a Used Drone (DJI Mini, Air, Mavic, Avata, Neo)',
    excerpt: 'Always fly before you buy. Flight hours, battery cycles, gimbal health and registration.',
    category: 'Buying Guides',
    html: `<h3>1. Demand an outdoor test flight</h3><p>Fly for at least 15 minutes through a full battery: GPS lock, stable hover, Return-to-Home, gimbal movement, camera recording and obstacle sensing. A seller refusing a test flight is an instant no.</p>
<h3>2. Check battery cycles</h3><p>In the DJI Fly app, check each battery's cycle count and health. DJI batteries are rated around 200 cycles; above 150 means budgeting for replacements (expensive in Sri Lanka). Inspect cells for swelling.</p>
<h3>3. Airframe and props</h3><p>Cracked arms, repaired shells, glued gimbals or bent motor shafts indicate hard crashes. Run the motors with fresh props and listen for grinding.</p>
<h3>4. Gimbal and camera</h3><p>The gimbal should level itself instantly without clicking. Record test footage and check for jello (vibration) and sensor spots.</p>
<h3>5. Controller and activation</h3><p>Confirm the original owner unlinks the drone from their DJI account in front of you so you can activate it on yours. Check the controller charges and links, plus cables and chargers.</p>
<h3>6. Registration in Sri Lanka</h3><p>Ask about any required Civil Aviation Authority registration and transfer paperwork, especially for drones above the basic Mini weight class. Keep the receipt and box to prove ownership.</p>`,
  },
];

module.exports = { PAGES, BLOG };
