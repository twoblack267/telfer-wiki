from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
img = Image.new("RGB", (W, H), (24, 26, 32))  # deep navy
d = ImageDraw.Draw(img)

# accent bar
d.rectangle([0, 0, W, 14], fill=(176, 152, 90))  # gold

# subtle family-tree motif
gold = (196, 168, 96)
muted = (120, 128, 140)

cx, cy = W // 2, 150
d.ellipse([cx - 70, cy - 16, cx + 70, cy + 16], outline=gold, width=3)
for dx in (-260, 260):
    d.line([cx, cy, cx + dx, cy + 70], fill=muted, width=3)
    d.ellipse([cx + dx - 50, cy + 54, cx + dx + 50, cy + 86], outline=muted, width=3)
    d.line([cx + dx, cy + 86, cx + dx, cy + 140], fill=muted, width=2)

def get(size):
    for p in [
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

title_font = get(96)
sub_font = get(40)

title = "Telfer Wiki"
bbox = d.textbbox((0, 0), title, font=title_font)
d.text(((W - (bbox[2] - bbox[0])) // 2, 230), title, fill=(236, 238, 242), font=title_font)

sub = "A family history, from Scotland to South Australia"
bbb = d.textbbox((0, 0), sub, font=sub_font)
d.text(((W - (bbb[2] - bbb[0])) // 2, 420), sub, fill=(176, 152, 90), font=sub_font)

img.save("/Users/marktelfer/telfer-wiki/public/telferwiki-og.png", "PNG")
print("OK")
