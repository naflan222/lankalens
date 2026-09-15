"""Reference catalog; only inserted by explicit database setup commands."""
import json

DEFAULT_SETTINGS = {
    "site_name": "Lanka Lens",
    "tagline": "Buy & Sell Cameras in Sri Lanka",
    # The website logo, used exactly as provided (see logoMark() in js/app.js
    # and .brand-mark in css/lankalens.css). An empty value falls back to the
    # built-in SVG mark, so deleting the file can never break the pages.
    "logo": "/images/Logo.png",
    "contact_email": "hello@lankalens.lk",
    "contact_phone": "+94 77 000 1111",
    "contact_address": "Colombo, Sri Lanka",
    "max_listings_per_user": "50",
    "max_images_per_listing": "3",
    "listing_expiry_days": "30",
    "require_approval": "0",
    "verification_required_to_sell": "0",
    "homepage_banners": "[]",
    "footer_text": "Sri Lanka's camera marketplace.",
    "social_facebook": "",
    "social_instagram": "",
    "social_youtube": "",
}

def _f(name, label, ftype="text", options=None, required=False):
    d = {"name": name, "label": label, "type": ftype, "required": required}
    if options:
        d["options"] = options
    return d


CAMERA_FIELDS = [
    _f("brand", "Brand", "select", ["Sony", "Canon", "Nikon", "Fujifilm", "Panasonic", "Olympus", "Leica", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("year", "Year", "text"),
    _f("shutter_count", "Shutter Count", "number"),
    _f("megapixels", "Megapixels", "text"),
    _f("video_resolution", "Video Resolution", "text"),
    _f("body_kit", "Body / Kit", "select", ["Body Only", "Body + Kit Lens"]),
    _f("lens_included", "Lens Included", "text"),
    _f("battery", "Battery", "text"),
    _f("charger", "Charger", "select", ["Yes", "No"]),
    _f("original_box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
    _f("reason_for_selling", "Reason for Selling", "textarea"),
]

LENS_FIELDS = [
    _f("brand", "Brand", "select", ["Canon", "Nikon", "Sony", "Fujifilm", "Sigma", "Tamron", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("mount", "Mount", "select", ["Canon EF", "Canon RF", "Nikon F", "Nikon Z", "Sony E", "Fujifilm X", "Micro Four Thirds", "Other"], True),
    _f("focal_length", "Focal Length", "text"),
    _f("max_aperture", "Maximum Aperture", "text"),
    _f("image_stabilization", "Image Stabilization", "select", ["Yes", "No"]),
    _f("autofocus", "Autofocus", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
]

ACTION_FIELDS = [
    _f("brand", "Brand", "select", ["GoPro", "DJI", "Insta360", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("resolution", "Resolution", "text"),
    _f("batteries", "Batteries", "text"),
    _f("accessories", "Accessories", "text"),
    _f("box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
]

DRONE_FIELDS = [
    _f("brand", "Brand", "select", ["DJI", "Autel", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("flight_time", "Flight Time", "text"),
    _f("battery_count", "Battery Count", "text"),
    _f("controller", "Controller", "text"),
    _f("accessories", "Accessories", "text"),
    _f("box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
]

ACCESSORY_FIELDS = [
    _f("brand", "Brand", "select", ["Manfrotto", "Zhiyun", "Godox", "SanDisk", "Rode", "Peak Design", "Lowepro", "DJI", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("compatibility", "Compatibility", "text"),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
]

CATEGORIES = [
    # (slug, name, icon, parent, sort, fields)
    ("cameras", "Cameras", "camera-outline", None, 1, "[]"),
    ("dslr", "DSLR", "camera-outline", "cameras", 1, json.dumps(CAMERA_FIELDS)),
    ("mirrorless", "Mirrorless", "camera-outline", "cameras", 2, json.dumps(CAMERA_FIELDS)),
    ("compact", "Compact", "camera-outline", "cameras", 3, json.dumps(CAMERA_FIELDS)),
    ("cinema-cameras", "Cinema Cameras", "videocam-outline", "cameras", 4, json.dumps(CAMERA_FIELDS)),
    ("other-cameras", "Other Cameras", "camera-outline", "cameras", 5, json.dumps(CAMERA_FIELDS)),

    ("lenses", "Lenses", "aperture-outline", None, 2, json.dumps(LENS_FIELDS)),
    ("lens-canon", "Canon", "aperture-outline", "lenses", 1, "[]"),
    ("lens-nikon", "Nikon", "aperture-outline", "lenses", 2, "[]"),
    ("lens-sony", "Sony", "aperture-outline", "lenses", 3, "[]"),
    ("lens-fujifilm", "Fujifilm", "aperture-outline", "lenses", 4, "[]"),
    ("lens-sigma", "Sigma", "aperture-outline", "lenses", 5, "[]"),
    ("lens-tamron", "Tamron", "aperture-outline", "lenses", 6, "[]"),
    ("lens-other", "Other", "aperture-outline", "lenses", 7, "[]"),

    ("action-cameras", "Action Cameras", "videocam-outline", None, 3, json.dumps(ACTION_FIELDS)),
    ("gopro", "GoPro", "videocam-outline", "action-cameras", 1, "[]"),
    ("dji-action", "DJI Action", "videocam-outline", "action-cameras", 2, "[]"),
    ("insta360", "Insta360", "videocam-outline", "action-cameras", 3, "[]"),
    ("action-other", "Other", "videocam-outline", "action-cameras", 4, "[]"),

    ("drones", "Drones", "navigate-outline", None, 4, json.dumps(DRONE_FIELDS)),
    ("drone-dji", "DJI", "navigate-outline", "drones", 1, "[]"),
    ("drone-autel", "Autel", "navigate-outline", "drones", 2, "[]"),
    ("drone-other", "Other", "navigate-outline", "drones", 3, "[]"),

    ("accessories", "Accessories", "layers-outline", None, 5, json.dumps(ACCESSORY_FIELDS)),
    ("tripods", "Tripods", "layers-outline", "accessories", 1, "[]"),
    ("gimbals", "Gimbals", "layers-outline", "accessories", 2, "[]"),
    ("camera-bags", "Camera Bags", "bag-handle-outline", "accessories", 3, "[]"),
    ("batteries", "Batteries", "battery-full-outline", "accessories", 4, "[]"),
    ("chargers", "Chargers", "battery-charging-outline", "accessories", 5, "[]"),
    ("memory-cards", "Memory Cards", "albums-outline", "accessories", 6, "[]"),
    ("filters", "Filters", "aperture-outline", "accessories", 7, "[]"),
    ("flashes", "Flashes", "flash-outline", "accessories", 8, "[]"),
    ("microphones", "Microphones", "mic-outline", "accessories", 9, "[]"),
    ("lights", "Lights", "bulb-outline", "accessories", 10, "[]"),
    ("gopro-accessories", "GoPro Accessories", "videocam-outline", "accessories", 11, "[]"),
    ("dji-accessories", "DJI Accessories", "navigate-outline", "accessories", 12, "[]"),
    ("accessories-other", "Other", "layers-outline", "accessories", 13, "[]"),
]

PROVINCES = {
    "Western Province": {
        "Colombo": ["Colombo", "Dehiwala-Mount Lavinia", "Moratuwa", "Sri Jayawardenepura Kotte", "Nugegoda", "Maharagama", "Kottawa", "Homagama", "Piliyandala", "Battaramulla", "Rajagiriya", "Kaduwela", "Avissawella", "Kolonnawa", "Wellawatte", "Bambalapitiya"],
        "Gampaha": ["Gampaha", "Negombo", "Wattala", "Ja-Ela", "Katunayake", "Kandana", "Ragama", "Kelaniya", "Kiribathgoda", "Kadawatha", "Minuwangoda", "Nittambuwa", "Veyangoda", "Mirigama", "Divulapitiya"],
        "Kalutara": ["Kalutara", "Panadura", "Horana", "Beruwala", "Aluthgama", "Matugama", "Bandaragama", "Wadduwa", "Agalawatta", "Bulathsinhala"],
    },
    "Central Province": {
        "Kandy": ["Kandy", "Peradeniya", "Katugastota", "Gampola", "Nawalapitiya", "Kundasale", "Digana", "Kadugannawa", "Akurana", "Pilimathalawa"],
        "Matale": ["Matale", "Dambulla", "Sigiriya", "Galewela", "Ukuwela", "Rattota", "Naula", "Pallepola"],
        "Nuwara Eliya": ["Nuwara Eliya", "Hatton", "Talawakele", "Kotagala", "Nanu Oya", "Ginigathhena", "Ragala", "Walapane"],
    },
    "Southern Province": {
        "Galle": ["Galle", "Hikkaduwa", "Ambalangoda", "Elpitiya", "Bentota", "Baddegama", "Karapitiya", "Unawatuna", "Ahangama", "Koggala"],
        "Matara": ["Matara", "Weligama", "Mirissa", "Akuressa", "Dikwella", "Hakmana", "Kamburupitiya", "Deniyaya", "Devinuwara"],
        "Hambantota": ["Hambantota", "Tangalle", "Beliatta", "Tissamaharama", "Ambalantota", "Kataragama", "Walasmulla", "Weeraketiya"],
    },
    "North Western Province": {
        "Kurunegala": ["Kurunegala", "Kuliyapitiya", "Pannala", "Narammala", "Wariyapola", "Nikaweratiya", "Polgahawela", "Mawathagama", "Galgamuwa"],
        "Puttalam": ["Puttalam", "Chilaw", "Wennappuwa", "Nattandiya", "Marawila", "Anamaduwa", "Kalpitiya", "Dankotuwa"],
    },
    "North Central Province": {
        "Anuradhapura": ["Anuradhapura", "Kekirawa", "Mihintale", "Medawachchiya", "Eppawala", "Thambuttegama", "Galenbindunuwewa", "Nochchiyagama"],
        "Polonnaruwa": ["Polonnaruwa", "Kaduruwela", "Minneriya", "Hingurakgoda", "Medirigiriya", "Welikanda", "Dimbulagala"],
    },
    "Eastern Province": {
        "Ampara": ["Ampara", "Kalmunai", "Akkaraipattu", "Sainthamaruthu", "Sammanthurai", "Pottuvil", "Uhana", "Maha Oya"],
        "Batticaloa": ["Batticaloa", "Kattankudy", "Eravur", "Valaichchenai", "Kalkudah", "Oddamavadi", "Vakarai"],
        "Trincomalee": ["Trincomalee", "Kinniya", "Muttur", "Kantale", "Nilaveli", "Kuchchaveli", "Seruwila"],
    },
    "Sabaragamuwa Province": {
        "Ratnapura": ["Ratnapura", "Embilipitiya", "Balangoda", "Pelmadulla", "Kuruwita", "Eheliyagoda", "Kahawatta", "Rakwana"],
        "Kegalle": ["Kegalle", "Mawanella", "Warakapola", "Rambukkana", "Ruwanwella", "Yatiyantota", "Deraniyagala", "Hemmathagama"],
    },
    "Uva Province": {
        "Badulla": ["Badulla", "Bandarawela", "Haputale", "Ella", "Welimada", "Mahiyanganaya", "Hali-Ela", "Passara"],
        "Monaragala": ["Monaragala", "Wellawaya", "Bibile", "Buttala", "Kataragama", "Siyambalanduwa", "Medagama"],
    },
    "Northern Province": {
        "Jaffna": ["Jaffna", "Nallur", "Chavakachcheri", "Point Pedro", "Kankesanthurai", "Kayts", "Kopay", "Chunnakam"],
        "Kilinochchi": ["Kilinochchi", "Poonakary", "Pallai", "Paranthan"],
        "Mannar": ["Mannar", "Murunkan", "Madhu", "Talaimannar"],
        "Mullaitivu": ["Mullaitivu", "Puthukkudiyiruppu", "Oddusuddan", "Mankulam"],
        "Vavuniya": ["Vavuniya", "Cheddikulam", "Nedunkeni", "Omanthai"],
    },
}

BRANDS = [
    ("Sony", "Cameras"), ("Canon", "Cameras"), ("Nikon", "Cameras"),
    ("Fujifilm", "Cameras"), ("Panasonic", "Cameras"), ("Olympus", "Cameras"),
    ("Sigma", "Lenses"), ("Tamron", "Lenses"), ("Tokina", "Lenses"),
    ("GoPro", "Action Cameras"), ("DJI", "Drones"), ("Autel", "Drones"),
    ("Insta360", "Action Cameras"), ("Manfrotto", "Accessories"),
    ("Zhiyun", "Accessories"), ("Godox", "Accessories"), ("SanDisk", "Accessories"),
    ("Rode", "Accessories"), ("Peak Design", "Accessories"), ("Lowepro", "Accessories"),
]

