from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageFilter


@dataclass(frozen=True)
class BlurRect:
    x: int
    y: int
    w: int
    h: int


ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    r"C:\Users\nikit\.cursor\projects\c-Users-nikit-Desktop-MetodiOne\assets"
)
DST = ROOT / "public" / "landing"

FILES = [
    ("01-finance-charts.png", "2026-04-23_215923-f058a4db-c94a-499f-a990-bbe6450dc84a"),
    ("02-kpi-matrix.png", "2026-04-23_215831-44947896-7eeb-4fb5-8479-c442d9f8a476"),
    ("03-lead-card.png", "2026-04-23_220140-7e9f2c8e-d5b4-470a-9543-4e038bde8722"),
    ("04-chat.png", "2026-04-23_220341-7d3082c3-e33f-4366-9882-cb22d807bb52"),
    ("05-finance-tables.png", "2026-04-23_215944-517691a0-66f0-4f63-9a31-cc1c85c2dd56"),
    ("06-finance-overview.png", "2026-04-23_215902-be3dc61b-d450-4468-a4ab-53a99503e509"),
    ("07-booking.png", "2026-04-23_220220-bb1df5b4-5901-49ce-a06c-cbca85656aac"),
    ("08-integrations.png", "2026-04-23_220422-0a1961b3-5c41-492d-a8cf-e73e69b93396"),
    ("09-tasks.png", "2026-04-23_215632-d03b3e9b-5919-4c3c-a207-94f8ae561c28"),
    ("10-analytics-detail.png", "2026-04-23_215735-71db751f-8769-43ff-ad05-ea8c1f115fbe"),
    ("11-analytics-funnel.png", "2026-04-23_215720-39f5ae8d-b22a-4adf-a1fc-a4cf5d6285f1"),
    ("12-crm-settings.png", "2026-04-23_213903-3db17766-4d7c-4776-ad86-895de74f1350"),
    ("13-crm-board.png", "2026-04-23_215416-eaaa7942-22f5-40fd-80e0-66e20ce9be6b"),
]

# Rectangles are tuned for 1024x576 screenshots and focus on personal
# identifiers (names, phone numbers, IDs).
BLUR_MAP: dict[str, list[BlurRect]] = {
    "02-kpi-matrix.png": [BlurRect(85, 198, 185, 250)],
    "03-lead-card.png": [
        BlurRect(305, 128, 265, 205),
        BlurRect(565, 197, 165, 75),
    ],
    "04-chat.png": [
        BlurRect(89, 116, 195, 413),
        BlurRect(330, 122, 255, 26),
    ],
    "07-booking.png": [BlurRect(230, 64, 515, 45)],
    "08-integrations.png": [BlurRect(218, 330, 595, 145)],
    "09-tasks.png": [BlurRect(540, 285, 230, 32)],
    "10-analytics-detail.png": [BlurRect(150, 220, 300, 255)],
    "12-crm-settings.png": [BlurRect(275, 262, 232, 30)],
    "13-crm-board.png": [BlurRect(145, 233, 620, 340)],
}


def locate_source(marker: str) -> Path:
    matches = [p for p in SRC.glob("*.png") if marker in p.name]
    if not matches:
        raise FileNotFoundError(f"Source not found for marker: {marker}")
    return matches[0]


def apply_blur(img: Image.Image, rects: list[BlurRect]) -> Image.Image:
    if not rects:
        return img
    out = img.copy()
    for r in rects:
        crop = out.crop((r.x, r.y, r.x + r.w, r.y + r.h))
        crop = crop.filter(ImageFilter.GaussianBlur(radius=12))
        out.paste(crop, (r.x, r.y))
    return out


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for dst_name, marker in FILES:
        src_path = locate_source(marker)
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            blurred = apply_blur(img, BLUR_MAP.get(dst_name, []))
            blurred.save(DST / dst_name, format="PNG", optimize=True)
            print(f"saved: {dst_name}")


if __name__ == "__main__":
    main()
