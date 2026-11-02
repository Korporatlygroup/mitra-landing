# INOK: Idhu Namme Oru Kedai

Landing page ("this is our shop") for the 2024 Digital Marketing Strategist Certification Programme, delivered by GET Academy.
Astro, static output. Rules and roles: [`CLAUDE.md`](CLAUDE.md). Plan and verified facts: [`docs/plan.md`](docs/plan.md).

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # → dist/
```

Content: `content/site.json` (copy + figures) and `content/media.json` (assets).
Media (local machine only): `python tools/optimize_media.py` → `public/media/`.
