# Client exports — 2026-10-21

Deliverables: `Vernatun-Client-HY.pdf` and `Vernatun-Client-HY.pptx` in `.local/outputs/`, registered in the Library. Generated from the updated 10-slide artifact after authenticated demo screenshots were added.

- Both exports contain ten slides with Armenian text.
- PDF: rendered all pages for visual inspection; fixed clipped ecosystem and finance layouts before the final export. Armenian Noto Sans fonts are embedded with Unicode mappings.
- PPTX: ZIP/XML checked for ten slides, Armenian editable text and media; Expo Web caption remains on slides 3 and 5. Fonts are referenced, **not embedded**. Install Noto Sans Armenian when editing to avoid substitution.
- PowerPoint desktop rendering was not available here; exact rendering in Microsoft Office was not verified. Use the PDF for fixed-layout client sharing.
- Labels distinguish Expo Web from responsive mobile web, not native Android.
- No pricing, delivery timeline, or native feature-parity promises were added.

Verification helper: `.agents/scripts/check-presentation-exports.py` (PyMuPDF). Temporary render sheets and reports live in ignored `.local/outputs/`. Slide validation, package typecheck and Vite build pass.
