"""
MITRA media preview builder (Windows / Mac / Linux).

Turns one or more media folders (or .zip files) into small contact sheets:
  - sheet_XX.jpg : contact sheets, 30 numbered thumbnails each
  - index.csv    : number -> file path, type, size, dimensions, duration, date

Usage (PowerShell):
  python mitra_previews.py "C:\\path\\to\\folder" ["C:\\other\\folder" ...] [--out DIR] [--frames N] [--zip]
  python mitra_previews.py "C:\\path\\to\\MITRA.zip"

--out     where sheets + index.csv go (default: ./_previews). Never point this inside the repo.
--frames  frames sampled per video (default 3).
--zip     also pack the output into MITRA_previews.zip inside --out.

Needs: Python 3, Pillow (pip install pillow). Optional: ffmpeg for video frames.
Folders with personal/financial data are skipped by default (see SKIP).
"""
import argparse, csv, os, shutil, subprocess, tempfile, zipfile
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageOps

SKIP = ["status proof", "peserta", "official documents", "financial", "b40", "m40"]
IMG = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff")
VID = (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".3gp")
TW, TH, COLS, ROWS = 320, 240, 6, 5
PER = COLS * ROWS

ap = argparse.ArgumentParser()
ap.add_argument("src", nargs="+")
ap.add_argument("--out", default="_previews")
ap.add_argument("--frames", type=int, default=3)
ap.add_argument("--zip", action="store_true")
args = ap.parse_args()

work = tempfile.mkdtemp(prefix="mitra_")
out = os.path.abspath(args.out); os.makedirs(out, exist_ok=True)
FF = shutil.which("ffmpeg"); FP = shutil.which("ffprobe")
if not FF:
    print("ffmpeg not found: videos will be listed without frames.")

def roots():
    for i, s in enumerate(args.src):
        if s.lower().endswith(".zip"):
            print(f"Extracting {s}...")
            dst = os.path.join(work, f"src{i}")
            with zipfile.ZipFile(s) as z:
                z.extractall(dst)
            yield dst, os.path.basename(s)
        else:
            yield s, os.path.basename(os.path.normpath(s))

def probe_duration(p):
    if not FP: return 0.0
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", p], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return 0.0

def grab(p, t, dst):
    subprocess.run([FF, "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", p,
                    "-frames:v", "1", "-vf", "scale=640:-2", dst])
    return Image.open(dst).convert("RGB") if os.path.exists(dst) else None

def exif_date(im):
    try:
        ex = im.getexif()
        v = ex.get_ifd(0x8769).get(36867) or ex.get(306)
        return v.replace(":", "-", 2) if v else ""
    except Exception: return ""

def tag(i):
    return "abcdefghijklmnopqrstuvwxyz"[i] if i < 26 else f".{i + 1}"

tiles, rows, skipped = [], [], 0
for root, label in roots():
    for d, dirs, files in os.walk(root):
        dirs.sort()
        rel_d = os.path.relpath(d, root).lower()
        if any(s in rel_d for s in SKIP):
            skipped += len(files); continue
        for f in sorted(files):
            p = os.path.join(d, f); e = os.path.splitext(f)[1].lower()
            rel = os.path.join(label, os.path.relpath(p, root)); mb = os.path.getsize(p) / 1e6
            mtime = datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d")
            try:
                if e in IMG:
                    im = Image.open(p); date = exif_date(im) or mtime
                    im = ImageOps.exif_transpose(im).convert("RGB"); w, h = im.size
                    im.thumbnail((TW, TH)); n = len(tiles) + 1
                    tiles.append((im, f"#{n}"))
                    rows.append([n, rel, "image", f"{mb:.1f}", f"{w}x{h}", "", date])
                elif e in VID:
                    dur = probe_duration(p); n0 = len(tiles) + 1
                    k = max(1, args.frames); frames = []
                    if FF:
                        for i in range(k):
                            t = dur * (i + 0.5) / k if dur else i * 2
                            fi = grab(p, t, os.path.join(work, "f.jpg"))
                            if fi: fi.thumbnail((TW, TH)); frames.append((fi, t))
                    for i, (fi, t) in enumerate(frames):
                        tiles.append((fi, f"#{n0}{tag(i)} {int(t // 60)}:{int(t % 60):02}"))
                    rows.append([n0, rel, "video", f"{mb:.1f}", "", f"{dur:.0f}s", mtime])
                    if not frames: tiles.append((Image.new("RGB", (TW, TH), "gray"), f"#{n0} VIDEO (no frame)"))
                else:
                    rows.append(["", rel, "other", f"{mb:.1f}", "", "", mtime])
            except Exception as x:
                rows.append(["", rel, f"error: {x}", f"{mb:.1f}", "", "", mtime])
            if len(tiles) % 50 == 0 and tiles: print(f"  {len(tiles)} tiles...")

try: font = ImageFont.truetype("arial.ttf", 16)
except Exception: font = ImageFont.load_default()
for s in range(0, len(tiles), PER):
    sheet = Image.new("RGB", (TW * COLS, (TH + 24) * ROWS), "white")
    dr = ImageDraw.Draw(sheet)
    for k, (im, label) in enumerate(tiles[s:s + PER]):
        x, y = (k % COLS) * TW, (k // COLS) * (TH + 24)
        sheet.paste(im, (x + (TW - im.width) // 2, y + (TH - im.height) // 2))
        dr.text((x + 4, y + TH + 3), label, fill="black", font=font)
    sheet.save(os.path.join(out, f"sheet_{s // PER + 1:02}.jpg"), quality=72)

with open(os.path.join(out, "index.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["num", "path", "type", "size_mb", "dims", "duration", "date"])
    w.writerows(rows)

if args.zip:
    dst = os.path.join(out, "MITRA_previews.zip")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(out)):
            if f != "MITRA_previews.zip": z.write(os.path.join(out, f), f)
shutil.rmtree(work, ignore_errors=True)
print(f"\nDone. {len(rows)} files indexed, {skipped} skipped (sensitive folders). Output: {out}")
