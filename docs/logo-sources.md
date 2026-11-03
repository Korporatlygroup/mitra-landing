# Partner logo sources

Downloaded 2026-11-03 from each organisation's own website. Files are converted to lossless `.webp` in
`public/media/logos/` (cropping only; nothing redrawn or recoloured).

> **Permission status:** CLAUDE.md still lists MITRA and SEGi logo permission as *pending*. These two were added at the
> user's explicit instruction for the staging sample build. They are **not cleared for a live launch**. No organisation
> below has confirmed permission to use its mark on this page.

| Logo id | Organisation | Source URL | Processing | Output |
|---|---|---|---|---|
| `logo-get` | GET Academy | https://geta.com.my/wp-content/uploads/2021/11/GETA-Logo.png (site icon on https://geta.com.my) | none | 115x112, **low resolution**; no larger standalone logo on the site |
| `logo-segi` | SEGi University | https://university.segi.edu.my/wp-content/uploads/sites/3/2025/06/Uni-header-logo-1_600x89.png (header of https://university.segi.edu.my) | cropped to the left 258 px to drop the QS rankings block | 258x89, **low resolution** |
| `logo-hrdf` | HRD Corp | https://hrdcorp.gov.my/wp-content/uploads/2021/02/KESUMA_HRDCorp_web.svg (from https://hrdcorp.gov.my) | rasterised; Ministry of Human Resources crest cropped off, HRD Corp mark kept | 600x174 |
| `logo-mdec` | MDEC | https://mdec.my/assets/mdec-logo-color.svg (from https://mdec.my) | rasterised | 600x110 |
| `logo-mitra` | MITRA | https://www.mitra.gov.my/images/MITRA.png (from https://www.mitra.gov.my) | resized to 800 px wide; wordmark only, no government crest | 800x244 |
| `logo-ten` | TEN | **not found** | none | no file: stays icon + name, `permitted: false` |

## Not done

- **TEN:** neither the repo (`site.json`, `docs/plan.md`) nor web searches say what TEN stands for, so no logo was
  sourced and nothing was guessed. Confirm the organisation's name with GET Academy.
- **Low-resolution files:** GET Academy and SEGi are small and will look soft on high-density screens. Ask each
  organisation for an SVG.
