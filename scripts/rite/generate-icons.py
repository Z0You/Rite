#!/usr/bin/env python3
"""Generate every Rite app icon (Android launcher + web favicons).

Usage:
  python3 scripts/rite/generate-icons.py                 # placeholder "R" icon
  python3 scripts/rite/generate-icons.py --logo logo.png # your own logo

The logo should be a square PNG, ideally 1024x1024 with a transparent background.
It is placed on the background colour and kept inside Android's adaptive-icon safe zone.
Requires Pillow:  pip install pillow
"""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
ANDROID_RES = ROOT / "packages/mobile/android/app/src/main/res"
WEB = ROOT / "packages/web/src"

BG_TOP = (49, 46, 129)  # indigo
BG_BOTTOM = (13, 148, 136)  # teal

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def gradient(size):
    img = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        draw.line([(0, y), (size, y)], fill=color)
    return img


def font(px):
    for candidate in FONT_CANDIDATES:
        if pathlib.Path(candidate).exists():
            return ImageFont.truetype(candidate, px)
    return ImageFont.load_default()


def mark(size, logo, color=(255, 255, 255, 255), scale=0.62):
    """Transparent image with the logo (or an "R") centred at `scale` of the canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * scale)
    if logo is not None:
        art = logo.copy()
        art.thumbnail((inner, inner), Image.LANCZOS)
        if color != (255, 255, 255, 255):  # monochrome silhouette
            alpha = art.getchannel("A")
            art = Image.new("RGBA", art.size, color)
            art.putalpha(alpha)
        img.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
        return img
    draw = ImageDraw.Draw(img)
    f = font(int(inner * 1.05))
    box = draw.textbbox((0, 0), "R", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), "R", font=f, fill=color)
    return img


def rounded(img, radius_ratio=0.22):
    size = img.width
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out


def full_icon(size, logo, round_corners=True):
    img = gradient(size)
    img.alpha_composite(mark(size, logo))
    return rounded(img) if round_corners else img


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print("  wrote", path.relative_to(ROOT))


def android(logo):
    legacy = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    adaptive = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    splash = {"mdpi": 154, "hdpi": 231, "xhdpi": 308, "xxhdpi": 462, "xxxhdpi": 616}
    for density, px in legacy.items():
        save(full_icon(px, logo), ANDROID_RES / f"mipmap-{density}/ic_launcher.png")
    for density, px in adaptive.items():
        save(gradient(px), ANDROID_RES / f"mipmap-{density}/ic_launcher_background.png")
        # Adaptive icons crop to the centre 66%; keep the mark well inside it.
        save(mark(px, logo, scale=0.42), ANDROID_RES / f"mipmap-{density}/ic_launcher_foreground.png")
    for density, px in splash.items():
        save(gradient(px), ANDROID_RES / f"drawable-{density}/ic_android_background.png")
        save(mark(px, logo, scale=0.42), ANDROID_RES / f"drawable-{density}/ic_android_foreground.png")
    save(mark(108, logo, scale=0.42), ANDROID_RES / "drawable/ic_launcher_monochrome.png")


def web(logo):
    fav = WEB / "favicon"
    for name, px in {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "apple-touch-icon.png": 180,
        "android-chrome-192x192.png": 192,
        "mstile-150x150.png": 150,
    }.items():
        save(full_icon(px, logo, round_corners=name != "apple-touch-icon.png"), fav / name)
    # Maskable icon: full-bleed background, mark in the safe zone.
    big = gradient(512)
    big.alpha_composite(mark(512, logo, scale=0.5))
    save(big, fav / "android-chrome-512x512.png")
    ico = full_icon(64, logo)
    ico.save(fav / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  wrote", (fav / "favicon.ico").relative_to(ROOT))

    manifest_path = WEB / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text())
    manifest.pop("app", None)
    manifest.update(
        name="Rite",
        short_name="Rite",
        description="End-to-end encrypted notes",
        theme_color="#312e81",
        background_color="#ffffff",
    )
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("  wrote", manifest_path.relative_to(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--logo", type=pathlib.Path, help="square PNG logo (transparent background recommended)")
    args = parser.parse_args()
    logo = Image.open(args.logo).convert("RGBA") if args.logo else None
    print("Android icons:")
    android(logo)
    print("Web icons:")
    web(logo)
    print("Done. Rebuild the app to see the new icons.")


if __name__ == "__main__":
    main()
