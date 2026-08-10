# Vertical loom responsive asset rebuild

## Produced files

| Asset | Intended crop | Dimensions | Format | Bytes | SHA-256 |
| --- | --- | ---: | --- | ---: | --- |
| `docs-site/src/assets/vertical-loom-desktop.webp` | Square desktop, right-hand hero | 1536 × 1536 | WebP (VP8) | 262,498 | `f94528497853f01e6fd1432a45a641ce980416f3371a41d0d0ec7ccb459ed21a` |
| `docs-site/src/assets/vertical-loom-mobile.webp` | Portrait compact/mobile hero | 1024 × 1536 | WebP (VP8) | 245,646 | `13f5fc5da381915d73553e000261becba896b8b443c8744164f7ee0e948edc90` |

Both assets were generated with the built-in image generator using `.impeccable/mocks/drawcord-b-vertical-loom.png` as the approved visual reference. The mobile generation also used the selected desktop generation as an assembly reference so both crops depict the same physical system. The selected desktop source was 1254 × 1254 and was Lanczos-upscaled to the required 1536 × 1536 canvas; the selected mobile source was generated at the required 1024 × 1536 canvas. Both final assets were encoded as quality-90 WebP.

## Composition and crop guidance

### Desktop square

- The loom occupies the right two-thirds; the left ~35% is intentionally quiet near-black textile for proposition/install content.
- Preserve the full square when practical. If a shallow desktop container must crop, anchor at `right center` and preserve at least normalized bounds `x 0.33–0.97 / y 0.02–0.98`; those bounds retain all three host pockets, every stage, the gathered fabric, and the lower plate.
- Do not center-crop the asset to a narrow portrait. Use the dedicated mobile asset instead.

### Mobile portrait

- Use the full 2:3 portrait canvas with `object-fit: contain` or a very conservative centered cover crop.
- The top host pockets and gold cord exits occupy the first quarter, while the gathered fabric and lower plate remain fully visible in the lower quarter. This makes both the inputs and ready-change outcome legible in the compact first view.
- Safe cover bounds are approximately `x 0.05–0.95 / y 0.02–0.98`. Cropping more aggressively risks losing outer host pockets or the side tension cords.

## Semantic overlay-safe regions

Coordinates are normalized percentages of each image canvas, measured from the top-left. They are conservative dark face regions chosen to avoid cord routes, eyelets, stitching, and brass locks. DOM overlays should still carry all real labels; no text is baked into either image.

### Desktop (1536 × 1536)

| Region | Normalized rectangle (`x / y / w / h`) | Pixel approximation |
| --- | --- | --- |
| Quiet copy field | `2% / 6% / 31% / 82%` | `31 / 92 / 476 / 1260` |
| Host pocket 1 | `39% / 5% / 13% / 8%` | `599 / 77 / 200 / 123` |
| Host pocket 2 | `58% / 5% / 13% / 8%` | `891 / 77 / 200 / 123` |
| Host pocket 3 | `77% / 5% / 13% / 8%` | `1183 / 77 / 200 / 123` |
| Stage pocket 1 | `40% / 29% / 18% / 6%` | `614 / 445 / 276 / 92` |
| Stage pocket 2 | `40% / 43% / 18% / 6%` | `614 / 660 / 276 / 92` |
| Stage pocket 3 | `40% / 57% / 18% / 6%` | `614 / 876 / 276 / 92` |
| Ready-change plate, right face | `69% / 83% / 13% / 8%` | `1060 / 1275 / 200 / 123` |

### Mobile (1024 × 1536)

| Region | Normalized rectangle (`x / y / w / h`) | Pixel approximation |
| --- | --- | --- |
| Host pocket 1 | `11% / 6% / 19% / 9%` | `113 / 92 / 195 / 138` |
| Host pocket 2 | `39% / 6% / 18% / 9%` | `399 / 92 / 184 / 138` |
| Host pocket 3 | `67% / 6% / 19% / 9%` | `686 / 92 / 195 / 138` |
| Stage pocket 1 | `11% / 30% / 27% / 6%` | `113 / 461 / 276 / 92` |
| Stage pocket 2 | `11% / 44% / 27% / 6%` | `113 / 676 / 276 / 92` |
| Stage pocket 3 | `11% / 58% / 27% / 6%` | `113 / 891 / 276 / 92` |
| Ready-change plate, right face | `53% / 82% / 22% / 9%` | `543 / 1260 / 225 / 138` |

## Prompt provenance and validation

- Exact desktop prompt: `docs-site/src/assets/vertical-loom-desktop.webp.json`; 3,304 characters; sidecar SHA-256 `56a66de92cb7ec98893a26c9b404c5ef030ddc5177bc34669be7bf68f466c630`.
- Exact mobile prompt: `docs-site/src/assets/vertical-loom-mobile.webp.json`; 3,575 characters; sidecar SHA-256 `1d5d02fb15b25c936c196df7cbce0bf4df523c068703ad41dc77d88b6b3d0e36`.
- Both prompts were written through `/Users/chris/.agents/skills/impeccable/scripts/embed-prompt.mjs`, using its documented WebP sidecar fallback.
- `embed-prompt.mjs <asset> --read` successfully recovered each complete prompt. SHA-256 of the recovered command output (including its terminal newline): desktop `59859de3fc021e573039033aa90f79aef40c15be3a72cbc9edbecd0526b0ab3d`; mobile `d91a47eba543283f6dc52f152442c56e5cc22c8610a9ef68953175f90a74070a`.

## Visual validation

One batched inspection of the final WebPs confirmed:

- exactly three blank woven host pockets at the top;
- genuine-looking braided muted-gold cords emerging through dimensional brass eyelets;
- exactly three layered sewn stage pockets with graphite stitch and restrained brass lock hardware;
- physically continuous routes converging into gathered matte-black fabric and one blank lower ready-change plate;
- broad, dark, cord-free label faces suitable for semantic overlays;
- desktop right-hand composition with quiet left-side content space;
- mobile first-view continuity from all host cords to the gathered ready-change outcome;
- no readable text, pseudo-text, logo, symbol, person, model, cape, fashion imagery, generic AI motif, neon, gradient, glow, glass, or watermark.

All lifecycle labels, host names, stage names, status names, and interaction semantics must remain in HTML/CSS/SVG/React rather than being added to these rasters.
