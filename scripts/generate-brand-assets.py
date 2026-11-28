#!/usr/bin/env python3
"""
Generates high-resolution (4x supersampled) Safezone brand assets:
- Mobile app icons (1024x1024)
- Android adaptive icon foregrounds (1024x1024, padded inside the 66% safe zone)
- Android adaptive icon monochrome (1024x1024)
- Notification icons (96x96 white silhouette on transparent)
- Splash screen marks (1024x1024 centered mark on Sand 50 #FAF7F2)
- Web favicons (32x32 favicon.png, favicon.ico, 180x180 apple-icon.png)
"""
from pathlib import Path
from PIL import Image, ImageDraw

FOREST_500 = (37, 77, 66, 255)      # #254D42
SAND_300 = (229, 216, 199, 255)     # #E5D8C7
SAND_50 = (250, 247, 242, 255)      # #FAF7F2
WHITE = (255, 255, 255, 255)        # #FFFFFF
TRANSPARENT = (0, 0, 0, 0)

ROOT = Path(__file__).resolve().parents[1]


def shield_polygon(cx: float, cy: float, scale: float, steps: int = 48) -> list[tuple[float, float]]:
    """
    Computes a smooth shield polygon centered at (cx, cy) mapped from a 32x32 design grid.
    Top crest at y=3.5, shoulders at (6, 7.5) and (26, 7.5), straight sides to y=15.5,
    and cubic curve to bottom tip at (16, 28.8).
    """
    def to_px(x32: float, y32: float) -> tuple[float, float]:
        return (cx + (x32 - 16.0) * scale, cy + (y32 - 16.0) * scale)

    pts: list[tuple[float, float]] = [
        to_px(16.0, 3.5),
        to_px(26.0, 7.5),
        to_px(26.0, 15.5),
    ]
    # Right cubic Bezier from (26, 15.5) -> (26, 22.1), (21.6, 26.9), (16, 28.8)
    p0, p1, p2, p3 = (26.0, 15.5), (26.0, 22.1), (21.6, 26.9), (16.0, 28.8)
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
        y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
        pts.append(to_px(x, y))

    # Left cubic Bezier from (16, 28.8) -> (10.4, 26.9), (6, 22.1), (6, 15.5)
    p0, p1, p2, p3 = (16.0, 28.8), (10.4, 26.9), (6.0, 22.1), (6.0, 15.5)
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = (mt**3) * p0[0] + 3 * (mt**2) * t * p1[0] + 3 * mt * (t**2) * p2[0] + (t**3) * p3[0]
        y = (mt**3) * p0[1] + 3 * (mt**2) * t * p1[1] + 3 * mt * (t**2) * p2[1] + (t**3) * p3[1]
        pts.append(to_px(x, y))

    pts.append(to_px(6.0, 7.5))
    return pts


def estate_polygon(cx: float, cy: float, scale: float, steps: int = 32) -> list[tuple[float, float]]:
    """
    Computes the inner pitched roof + estate gate portal polygon mapped from a 32x32 design grid.
    """
    import math

    def to_px(x32: float, y32: float) -> tuple[float, float]:
        return (cx + (x32 - 16.0) * scale, cy + (y32 - 16.0) * scale)

    pts: list[tuple[float, float]] = [
        to_px(16.0, 9.2),
        to_px(22.2, 14.2),
        to_px(22.2, 22.2),
        to_px(18.2, 22.2),
        to_px(18.2, 17.4),
    ]
    # Semicircle arch from angle 0 (x=18.2, y=17.4) to pi (x=13.8, y=17.4) centered at (16, 17.4) radius 2.2
    for i in range(1, steps):
        theta = math.pi * (i / steps)
        x = 16.0 + 2.2 * math.cos(theta)
        y = 17.4 - 2.2 * math.sin(theta)
        pts.append(to_px(x, y))

    pts.extend([
        to_px(13.8, 17.4),
        to_px(13.8, 22.2),
        to_px(9.8, 22.2),
        to_px(9.8, 14.2),
    ])
    return pts


def draw_mark(
    size: int,
    bg_color: tuple[int, int, int, int],
    shield_color: tuple[int, int, int, int],
    inner_color: tuple[int, int, int, int],
    keystone_color: tuple[int, int, int, int],
    mark_fraction: float = 0.78,
    tile_color: tuple[int, int, int, int] | None = None,
    tile_fraction: float = 0.42,
    tile_radius_fraction: float = 0.24,
    supersample: int = 4,
) -> Image.Image:
    W = size * supersample
    img = Image.new("RGBA", (W, W), bg_color)
    draw = ImageDraw.Draw(img)
    cx, cy = W / 2.0, W / 2.0

    if tile_color is not None:
        tw = W * tile_fraction
        x0, y0 = cx - tw / 2.0, cy - tw / 2.0
        x1, y1 = cx + tw / 2.0, cy + tw / 2.0
        draw.rounded_rectangle([x0, y0, x1, y1], radius=tw * tile_radius_fraction, fill=tile_color)

    # Scale from 32-unit grid into mark_fraction of canvas
    scale = (W * mark_fraction) / 32.0
    draw.polygon(shield_polygon(cx, cy, scale), fill=shield_color)
    draw.polygon(estate_polygon(cx, cy, scale), fill=inner_color)

    # Keystone dot at (16, 13.2) with radius 1.25
    kx = cx
    ky = cy + (13.2 - 16.0) * scale
    kr = 1.25 * scale
    draw.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=keystone_color)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    # 1. Master brand assets in docs/brand/
    brand_dir = ROOT / "docs" / "brand"
    brand_dir.mkdir(parents=True, exist_ok=True)

    app_icon = draw_mark(
        size=1024,
        bg_color=FOREST_500,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.76,
    )
    app_icon.save(brand_dir / "app-icon-1024.png", "PNG", optimize=True)

    # Android adaptive icon foreground: safe zone is central 66%, so mark_fraction=0.58 stays well inside
    adaptive_fg = draw_mark(
        size=1024,
        bg_color=TRANSPARENT,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.58,
    )
    adaptive_fg.save(brand_dir / "adaptive-icon-foreground-1024.png", "PNG", optimize=True)

    # Android monochrome icon (white with transparent cut-out)
    adaptive_mono = draw_mark(
        size=1024,
        bg_color=TRANSPARENT,
        shield_color=WHITE,
        inner_color=TRANSPARENT,
        keystone_color=WHITE,
        mark_fraction=0.58,
    )
    adaptive_mono.save(brand_dir / "adaptive-icon-monochrome-1024.png", "PNG", optimize=True)

    # Notification icon (96x96 white silhouette on transparent)
    notif_icon = draw_mark(
        size=96,
        bg_color=TRANSPARENT,
        shield_color=WHITE,
        inner_color=TRANSPARENT,
        keystone_color=WHITE,
        mark_fraction=0.82,
    )
    notif_icon.save(brand_dir / "notification-icon-96.png", "PNG", optimize=True)

    # Splash screen (Sand 50 background with centered Forest rounded tile & mark)
    splash_icon = draw_mark(
        size=1024,
        bg_color=SAND_50,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.28,
        tile_color=FOREST_500,
        tile_fraction=0.34,
        tile_radius_fraction=0.25,
    )
    splash_icon.save(brand_dir / "splash-1024.png", "PNG", optimize=True)

    # 2. Populate Expo mobile apps
    mobile_apps = ["resident-mobile", "management-mobile", "security-mobile"]
    for app_name in mobile_apps:
        assets_dir = ROOT / "apps" / app_name / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        app_icon.save(assets_dir / "icon.png", "PNG", optimize=True)
        adaptive_fg.save(assets_dir / "adaptive-icon.png", "PNG", optimize=True)
        adaptive_mono.save(assets_dir / "monochrome-icon.png", "PNG", optimize=True)
        notif_icon.save(assets_dir / "notification-icon.png", "PNG", optimize=True)
        splash_icon.save(assets_dir / "splash-icon.png", "PNG", optimize=True)

    # 3. Populate Next.js web apps (favicon.ico, apple-icon.png, icon.svg)
    apple_icon = draw_mark(
        size=180,
        bg_color=FOREST_500,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.76,
    )
    favicon_32 = draw_mark(
        size=32,
        bg_color=FOREST_500,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.82,
    )
    favicon_16 = draw_mark(
        size=16,
        bg_color=FOREST_500,
        shield_color=SAND_300,
        inner_color=WHITE,
        keystone_color=FOREST_500,
        mark_fraction=0.84,
    )

    web_apps = ["public-web", "management-web", "super-admin"]
    for web_name in web_apps:
        app_dir = ROOT / "apps" / web_name / "app"
        apple_icon.save(app_dir / "apple-icon.png", "PNG", optimize=True)
        favicon_32.save(
            app_dir / "favicon.ico",
            format="ICO",
            sizes=[(16, 16), (32, 32)],
            append_images=[favicon_16],
        )

    print("Generated all Safezone brand and icon assets.")


if __name__ == "__main__":
    main()
