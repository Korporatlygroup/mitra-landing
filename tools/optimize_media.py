"""
Optimise selected MITRA media into public/media/ and fill sizes back into content/media.json.
LOCAL session only: needs the raw media folder (never committed).

Usage (PowerShell, from the repo root):
  python tools/optimize_media.py                      # all entries with a "source"
  python tools/optimize_media.py --only hero-01 gal-03
  python tools/optimize_media.py --src "D:\\other\\mitra" --force

Per entry in media.json (only those with "source", a path relative to --src;
prefix "extra:" for files supplied separately, relative to --extra):
  type image  -> media/<id>.webp (<=1920 px wide) + media/<id>-sm.webp (800 px)
                 source may be a video: set "frame" ("m:ss" or seconds) to grab a still.
                 optional "crop": [x, y, w, h] and "blur": [[x, y, w, h], ...], fractions of the source frame.
  type logo   -> media/logos/<id>.webp (<=600 px wide, keeps transparency)
  type video  -> media/<id>.mp4 (H.264, <=720p or "max_h", CRF 28, "start"/"duration", "mute", "maxrate") + media/<id>-poster.webp ("poster_at")
Writes back: file, w, h, bytes (+ file_sm / poster). Budget: images <400 KB, clips <8 MB, public/media <100 MB.

Needs: Python 3, Pillow, ffmpeg/ffprobe on PATH.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageFilter, ImageOps

SKIP = ["status proof", "peserta", "official documents", "financial", "b40", "m40"]
VID = (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".3gp")
IMG_MAX, IMG_SM, LOGO_MAX = 1920, 800, 600
# Total covers on-demand video too (preload="none"); 14 interview parts take ~52 MB of it.
IMG_BUDGET, CLIP_BUDGET, TOTAL_BUDGET = 400_000, 8_000_000, 100_000_000

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--media", default=os.path.join(repo, "content", "media.json"))
ap.add_argument("--src", default=os.environ.get("MITRA_SRC", r"C:\Korporatlygroup\INOK\mitra"))
ap.add_argument("--extra", default=os.environ.get("MITRA_EXTRA", r"C:\Korporatlygroup\_media-extra"),
                help="folder for media supplied outside the raw MITRA folder (headshots, logos)")
ap.add_argument("--public", default=os.path.join(repo, "public"))
ap.add_argument("--only", nargs="*")
ap.add_argument("--force", action="store_true", help="rebuild even if the output exists")
args = ap.parse_args()

FF, FP = shutil.which("ffmpeg"), shutil.which("ffprobe")
work = tempfile.mkdtemp(prefix="mitra_opt_")
src_root = os.path.realpath(args.src)
extra_root = os.path.realpath(args.extra)

def seconds(v):
    if isinstance(v, (int, float)): return float(v)
    m, _, s = str(v).rpartition(":")
    return float(m or 0) * 60 + float(s)

def resolve(rel):
    root = src_root
    if rel.startswith("extra:"):
        root, rel = extra_root, rel[len("extra:"):]
    p = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([p, root]) != root:
        sys.exit(f"source escapes --src: {rel}")
    if any(s in rel.lower() for s in SKIP):
        sys.exit(f"refusing sensitive folder: {rel}")
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    return p

def ff(*a):
    r = subprocess.run([FF, "-y", "-v", "error", *a], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr.strip())

def box(im, b):
    x, y, w, h = b
    return (round(x * im.width), round(y * im.height), round((x + w) * im.width), round((y + h) * im.height))

def save_webp(im, dst, max_w, budget, lossless=False):
    im = im.copy()
    if im.width > max_w: im.thumbnail((max_w, 10_000), Image.LANCZOS)
    for q in (80, 74, 68, 62, 56):
        im.save(dst, "WEBP", quality=q, method=6, lossless=lossless)
        if lossless or os.path.getsize(dst) <= budget: break
    return im.size, os.path.getsize(dst)

def load_still(e, p):
    if p.lower().endswith(VID):
        tmp = os.path.join(work, f"{e['id']}.png")
        ff("-ss", f"{seconds(e.get('frame', 0)):.2f}", "-i", p, "-frames:v", "1", tmp)
        p = tmp
    im = ImageOps.exif_transpose(Image.open(p))
    radius = e.get("blur_radius", max(8, im.width // 150))
    for b in e.get("blur", []):
        r = box(im, b)
        im.paste(im.crop(r).filter(ImageFilter.GaussianBlur(radius)), r[:2])
    if e.get("crop"): im = im.crop(box(im, e["crop"]))
    return im

def do_image(e, p, out):
    im = load_still(e, p).convert("RGB")
    (w, h), n = save_webp(im, os.path.join(out, f"{e['id']}.webp"), IMG_MAX, IMG_BUDGET)
    sm = os.path.join(out, f"{e['id']}-sm.webp")
    if w > IMG_SM:
        save_webp(im, sm, IMG_SM, IMG_BUDGET // 3)
        e["file_sm"] = f"media/{e['id']}-sm.webp"
    else:  # source too small for a separate small size
        e.pop("file_sm", None)
        if os.path.exists(sm): os.remove(sm)
    e.update(file=f"media/{e['id']}.webp", w=w, h=h, bytes=n)
    return n

def do_logo(e, p, out):
    os.makedirs(os.path.join(out, "logos"), exist_ok=True)
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGBA")
    if e.get("crop"): im = im.crop(box(im, e["crop"]))
    (w, h), n = save_webp(im, os.path.join(out, "logos", f"{e['id']}.webp"), LOGO_MAX, 120_000)
    e.update(file=f"media/logos/{e['id']}.webp", w=w, h=h, bytes=n)
    return n

def do_video(e, p, out):
    dst = os.path.join(out, f"{e['id']}.mp4")
    a = ["-ss", f"{seconds(e.get('start', 0)):.2f}"]
    if e.get("duration"): a += ["-t", f"{seconds(e['duration']):.2f}"]
    # Landscape caps the height at 720; vertical clips set max_h (e.g. 960 for 540x960).
    a += ["-i", p, "-vf", f"scale=-2:'min({e.get('max_h', 720)},ih)'", "-c:v", "libx264", "-preset", "slow",
          "-crf", str(e.get("crf", 28)), "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    # Long films: cap the bitrate so the file stays under the host's per-file limit (Cloudflare Pages: 25 MiB).
    if e.get("maxrate"): a += ["-maxrate", e["maxrate"], "-bufsize", e["maxrate"]]
    a += ["-an"] if e.get("mute", True) else ["-c:a", "aac", "-b:a", "96k"]
    ff(*a, dst)
    poster = os.path.join(work, f"{e['id']}-poster.png")
    ff("-ss", f"{seconds(e.get('poster_at', 0)):.2f}", "-i", dst, "-frames:v", "1", poster)
    (pw, ph), pn = save_webp(Image.open(poster).convert("RGB"), os.path.join(out, f"{e['id']}-poster.webp"), IMG_MAX, IMG_BUDGET)
    r = subprocess.run([FP, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0", dst], capture_output=True, text=True)
    w, h = (int(x) for x in r.stdout.strip().split(","))
    n = os.path.getsize(dst)
    e.update(file=f"media/{e['id']}.mp4", poster=f"media/{e['id']}-poster.webp", w=w, h=h, bytes=n)
    if n > CLIP_BUDGET: print(f"  ! {e['id']}: {n / 1e6:.1f} MB > 8 MB: shorten it, raise crf, or host on YouTube/Vimeo")
    return n + pn

with open(args.media, encoding="utf-8") as fh:
    data = json.load(fh)
out = os.path.join(args.public, "media"); os.makedirs(out, exist_ok=True)

done = 0
for e in data["items"]:
    if not e.get("source") or (args.only and e["id"] not in args.only): continue
    target = os.path.join(args.public, e["file"]) if e.get("file") else None
    if target and os.path.exists(target) and not args.force and e.get("bytes"): continue
    try:
        p = resolve(e["source"])
        n = {"image": do_image, "logo": do_logo, "video": do_video}[e["type"]](e, p, out)
        done += 1
        print(f"  {e['id']:<14} {e['type']:<5} {e['w']}x{e['h']}  {n / 1e3:,.0f} KB")
        if e["type"] == "image" and e["bytes"] > IMG_BUDGET: print(f"  ! {e['id']}: over 400 KB")
    except FileNotFoundError as x:
        print(f"  ? {e['id']}: source not found ({x})")

with open(args.media, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2); fh.write("\n")
shutil.rmtree(work, ignore_errors=True)

total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
print(f"\n{done} built. public/media = {total / 1e6:.1f} MB" + ("  ! over 100 MB budget" if total > TOTAL_BUDGET else ""))
