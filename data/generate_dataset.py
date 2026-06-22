#!/usr/bin/env python3
"""
Generate a clean, realistic search-query dataset for a typeahead system.

Correct-by-construction design (every rule maps to a viva talking point):
  - PHONE MODELS only attach to phone brands (no "macbook s25").
  - STORAGE sizes only attach to storage-capable items (phones/tablets/ssd),
    handled as a dedicated layer (no "charger 256gb").
  - No dangling "vs"; comparisons are explicit "a vs b".
  - Rich PREFIX CLUSTERS (shared head terms) so typeahead is visibly meaningful.
  - A CURATED HEAD of marquee queries with realistic high counts, matching the
    assignment's own example (iphone = 100000), so demos are predictable.
  - ZIPFIAN counts over the remaining long tail.
  - >= 100,000 unique queries.
"""

import csv
import random

random.seed(42)  # deterministic -> same file every run -> reproducible demo

# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------

PHONE_BRANDS = [
    "iphone", "samsung galaxy", "google pixel", "oneplus", "xiaomi", "nothing phone",
    "realme", "oppo", "vivo", "motorola", "redmi", "poco", "iqoo", "honor",
]
# Realistic model list PER brand (no cross-brand contamination)
PHONE_MODELS_BY_BRAND = {
    "iphone": ["11", "12", "13", "14", "15", "16", "15 pro", "15 pro max",
               "16 pro", "16 pro max", "se", "xr"],
    "samsung galaxy": ["s22", "s23", "s24", "s25", "s24 ultra", "s25 ultra",
                       "z flip 5", "z fold 5", "a54", "m34", "f54", "note 20"],
    "google pixel": ["6", "7", "8", "9", "7 pro", "8 pro", "9 pro", "6a", "7a", "8a", "fold"],
    "oneplus": ["10", "11", "12", "13", "11 pro", "nord", "nord ce", "nord 3", "open"],
    "xiaomi": ["13", "14", "13 pro", "14 pro", "13t", "14t", "mi 11"],
    "nothing phone": ["1", "2", "2a", "3", "3a"],
    "realme": ["11", "12", "c55", "c67", "gt", "gt neo", "narzo", "p1"],
    "oppo": ["reno 11", "reno 12", "f25", "a78", "find x7", "k12"],
    "vivo": ["v29", "v30", "y28", "t3", "x100", "x100 pro"],
    "motorola": ["edge 50", "g54", "g84", "razr 50", "edge 40"],
    "redmi": ["note 13", "note 14", "13 pro", "14 pro", "a3", "12c"],
    "poco": ["x6", "x6 pro", "f6", "f6 pro", "m6", "c65"],
    "iqoo": ["12", "13", "neo 9", "z9", "z9 turbo"],
    "honor": ["90", "200", "x9b", "magic 6", "magic 6 pro"],
}
PHONE_STORAGE = ["64gb", "128gb", "256gb", "512gb", "1tb"]
PHONE_COLORS = ["black", "white", "blue", "silver", "green", "titanium", "midnight"]

LAPTOP_BRANDS = [
    "macbook", "macbook air", "macbook pro", "dell xps", "lenovo thinkpad",
    "lenovo legion", "hp pavilion", "hp omen", "asus rog", "asus zenbook",
    "acer aspire", "acer predator", "msi",
]
LAPTOP_CONFIGS = ["i5", "i7", "i9", "ryzen 5", "ryzen 7", "8gb ram", "16gb ram",
                  "32gb ram", "512gb ssd", "1tb ssd", "13 inch", "14 inch", "15 inch", "16 inch"]
LAPTOP_PRODUCTS = ["charger", "case", "sleeve", "cooling pad", "docking station",
                   "stand", "skin", "bag", "screen protector"]

TABLET_BRANDS = ["ipad", "ipad air", "ipad pro", "samsung tab", "kindle"]
TABLET_PRODUCTS = ["case", "cover", "screen protector", "stylus", "charger", "stand", "keyboard"]

AUDIO_BRANDS = ["sony", "bose", "jbl", "boat", "sennheiser", "marshall", "skullcandy"]
AUDIO_PRODUCTS = ["earbuds", "headphones", "speaker", "earphones", "neckband", "soundbar"]

PERIPHERAL_BRANDS = ["logitech", "razer", "corsair", "hyperx", "redgear"]
PERIPHERAL_PRODUCTS = ["mouse", "keyboard", "mechanical keyboard", "webcam",
                       "microphone", "headset", "mousepad"]

COMPONENT_BRANDS = ["nvidia rtx", "amd ryzen", "intel core", "wd", "seagate", "samsung"]
COMPONENT_PRODUCTS = ["ssd", "hard drive", "ram", "graphics card", "processor", "power supply"]

WEARABLE_BRANDS = ["apple watch", "garmin", "fitbit", "samsung watch", "noise", "fire boltt"]
WEARABLE_PRODUCTS = ["band", "strap", "charger", "case", "screen protector"]

# legit e-commerce modifiers (NO storage tokens, NO bare "vs")
ATTRS = [
    "price", "review", "reviews", "specifications", "specs", "deals", "offer",
    "discount", "emi", "exchange offer", "buy online", "online", "near me",
    "second hand", "refurbished", "unboxing", "release date", "launch date",
    "features", "comparison", "alternatives", "warranty", "amazon", "flipkart",
    "croma", "service center", "best", "cheap", "cheapest", "premium", "latest",
    "2024", "2025", "2026", "with bill", "full review", "hands on",
    "first impressions", "problems", "issues", "battery life", "camera", "display",
    "for students", "for office", "for gaming", "lightweight", "original",
    "combo", "pack of 2", "under 20000", "under 50000",
]

PROGRAMMING = [
    "java", "python", "javascript", "typescript", "react", "node js", "express js",
    "spring boot", "django", "flask", "golang", "rust", "kotlin", "swift",
    "c++", "c sharp", "sql", "mongodb", "postgresql", "redis", "docker", "kubernetes",
    "git", "linux", "aws", "azure",
]
PROG_INTENT = [
    "tutorial", "tutorial for beginners", "tutorial pdf", "interview questions",
    "interview questions and answers", "cheat sheet", "documentation", "example",
    "examples", "roadmap", "course", "course free", "certification", "projects",
    "projects for beginners", "best practices", "error", "not working", "install",
    "install on windows", "install on mac", "install on ubuntu", "setup",
    "for data science", "for web development", "for beginners", "advanced",
]

FASHION_BRANDS = ["nike", "adidas", "puma", "reebok", "levis", "zara", "h and m", "uniqlo", "gucci"]
FASHION_ITEMS = ["shoes", "running shoes", "sneakers", "t shirt", "jeans", "jacket",
                 "hoodie", "watch", "backpack", "sunglasses", "cap", "socks", "shorts", "sandals"]

GROCERY = ["organic", "fresh", "whole wheat", "gluten free", "basmati rice", "olive oil",
           "green tea", "coffee beans", "protein powder", "almonds", "peanut butter",
           "dark chocolate", "honey", "oats"]

HOWTO = ["how to cook", "how to make", "how to fix", "how to install", "how to learn",
         "how to draw", "how to invest in", "how to start", "how to clean", "how to delete"]
HOWTO_OBJ = ["pasta", "biryani", "pancakes", "a website", "python", "guitar", "stocks",
             "a business", "a laptop", "an account", "the screen", "an air conditioner"]

CITIES = ["bangalore", "mumbai", "delhi", "hyderabad", "chennai", "pune", "kolkata",
          "london", "new york", "tokyo", "dubai", "singapore"]
TRAVEL_PRE = ["flights to", "hotels in", "things to do in", "restaurants in",
              "tourist places in", "best time to visit"]
TRAVEL_POST = ["weather", "metro map", "airport", "nightlife", "shopping"]

# ---------------------------------------------------------------------------
# Build unique query universe
# ---------------------------------------------------------------------------
queries = set()
def add(q):
    q = " ".join(q.split()).strip().lower()
    if q:
        queries.add(q)

# Phones: bare, model, model+attr, model+storage, model+color, accessory, accessory+attr
PHONE_ACCESSORIES = ["charger", "case", "cover", "screen protector", "tempered glass",
                     "back cover", "cable", "adapter", "power bank"]
for b in PHONE_BRANDS:
    add(b)
    for a in ATTRS:
        add(f"{b} {a}")
    for m in PHONE_MODELS_BY_BRAND[b]:
        add(f"{b} {m}")
        for a in ATTRS:
            add(f"{b} {m} {a}")
        for s in PHONE_STORAGE:
            add(f"{b} {m} {s}")
            for a in ATTRS:                       # "iphone 15 256gb price"
                add(f"{b} {m} {s} {a}")
        for c in PHONE_COLORS:
            add(f"{b} {m} {c}")
            for a in ATTRS:                       # "iphone 15 blue price"
                add(f"{b} {m} {c} {a}")
    for acc in PHONE_ACCESSORIES:
        add(f"{b} {acc}")
        for a in ATTRS:
            add(f"{b} {acc} {a}")

# Laptops
for b in LAPTOP_BRANDS:
    add(b)
    for a in ATTRS:
        add(f"{b} {a}")
    for cfg in LAPTOP_CONFIGS:
        add(f"{b} {cfg}")
        for a in ATTRS[:40]:
            add(f"{b} {cfg} {a}")
    for p in LAPTOP_PRODUCTS:
        add(f"{b} {p}")

# Tablets
for b in TABLET_BRANDS:
    add(b)
    for a in ATTRS:
        add(f"{b} {a}")
    for s in PHONE_STORAGE:
        add(f"{b} {s}")
    for p in TABLET_PRODUCTS:
        add(f"{b} {p}")
        for a in ATTRS[:30]:
            add(f"{b} {p} {a}")

# Audio / peripheral / component / wearable: brand + product (+ attr)
for brands, prods in [(AUDIO_BRANDS, AUDIO_PRODUCTS),
                      (PERIPHERAL_BRANDS, PERIPHERAL_PRODUCTS),
                      (COMPONENT_BRANDS, COMPONENT_PRODUCTS),
                      (WEARABLE_BRANDS, WEARABLE_PRODUCTS)]:
    for b in brands:
        add(b)
        for a in ATTRS:
            add(f"{b} {a}")
        for p in prods:
            add(f"{b} {p}")
            for a in ATTRS[:40]:
                add(f"{b} {p} {a}")

# Programming
for lang in PROGRAMMING:
    add(lang)
    for i in PROG_INTENT:
        add(f"{lang} {i}")
    for lang2 in PROGRAMMING:
        if lang != lang2:
            add(f"{lang} vs {lang2}")

# Fashion
for b in FASHION_BRANDS:
    add(b)
    for it in FASHION_ITEMS:
        add(f"{b} {it}")
        for a in ATTRS[:45]:
            add(f"{b} {it} {a}")

# Grocery
for g in GROCERY:
    add(g); add(f"buy {g}"); add(f"{g} online"); add(f"{g} price"); add(f"organic {g}")

# How-to
for h in HOWTO:
    for o in HOWTO_OBJ:
        add(f"{h} {o}")

# Travel
for c in CITIES:
    add(c)
    for t in TRAVEL_PRE:
        add(f"{t} {c}")
    for t in TRAVEL_POST:
        add(f"{c} {t}")

queries = list(queries)
print(f"Unique queries built: {len(queries)}")

# ---------------------------------------------------------------------------
# Curated marquee head (guaranteed realistic high counts, descending)
# ---------------------------------------------------------------------------
CURATED = [
    ("iphone", 100000), ("iphone 15", 88000), ("iphone 16", 81000),
    ("samsung galaxy", 76000), ("python", 72000), ("python tutorial", 68000),
    ("nike shoes", 64000), ("iphone 15 pro", 61000), ("java", 58000),
    ("ipad", 54000), ("macbook air", 51000), ("javascript", 48000),
    ("nike", 46000), ("react", 44000), ("adidas", 41000),
    ("samsung galaxy s24", 39000), ("aws", 37000), ("macbook pro", 35000),
    ("oneplus", 33000), ("docker", 31000), ("google pixel", 29000),
    ("sql", 27000), ("ipad pro", 25000), ("git", 24000),
    ("python interview questions", 23000), ("node js", 22000),
    ("bangalore weather", 21000), ("kubernetes", 20000),
    ("iphone 15 pro max", 19500), ("realme", 19000),
]
curated_set = {q for q, _ in CURATED}

# ---------------------------------------------------------------------------
# Zipfian counts for the rest
# ---------------------------------------------------------------------------
rest = [q for q in queries if q not in curated_set]
# Shorter / head-ier queries tend to be more popular
rest.sort(key=lambda q: (len(q.split()), len(q), random.random()))

START = 18000  # tail starts just below the curated floor
S = 1.05
rows = list(CURATED)
for rank, q in enumerate(rest, start=1):
    base = START / (rank ** S)
    jitter = random.uniform(0.6, 1.5)
    count = max(1, int(base * jitter))
    rows.append((q, count))

rows.sort(key=lambda r: r[1], reverse=True)

with open("queries.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["query", "count"])
    w.writerows(rows)

print(f"Wrote queries.csv with {len(rows)} rows")
