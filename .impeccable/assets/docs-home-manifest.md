# Docs homepage generated asset manifest

## Produced file

- Asset: `docs-site/src/assets/drawcord-textile.webp`
- Format: WebP (VP8)
- Dimensions: 2048 × 1152 px (16:9 landscape)
- File size: 234,136 bytes
- SHA-256: `1ef732b07c8fb3e7bf0120cc68274188a7a10181ddb4dad4280bfea8bc72df89`
- Generation: built-in image generation, using `.impeccable/mocks/drawcord-b-vertical-loom.png` as a material/style reference only; selected 1672 × 941 source was cropped and upscaled to the required final canvas.

## Crop guidance

- Desktop: use as a full-bleed hero/background with `background-size: cover` and a centered position. The broad quiet center and distributed diagonal channels leave room for semantic overlays across the width.
- Mobile: retain a centered crop (`background-position: 50% 50%`). The middle third contains continuous low-contrast textile without any essential focal detail, so portrait viewport crops remain useful.
- Avoid stretching to a non-proportional aspect ratio. Let `cover` crop the outside edges instead.
- Apply any legibility scrim as a flat semantic CSS color layer, not as a gradient glow baked into the image.

## Prompt provenance

- The exact generation prompt was passed to `/Users/chris/.agents/skills/impeccable/scripts/embed-prompt.mjs`.
- Because the script stores WebP prompt metadata via its documented sidecar fallback, the recoverable prompt is at `docs-site/src/assets/drawcord-textile.webp.json`.
- Validation: `node /Users/chris/.agents/skills/impeccable/scripts/embed-prompt.mjs docs-site/src/assets/drawcord-textile.webp --read` returned the exact prompt successfully.

## Must remain semantic code

The raster is background material only. These approved-comp ingredients must remain authored and accessible in HTML, CSS, React, or SVG:

- All text: product name, headline, supporting copy, labels, commands, lifecycle steps, and statuses.
- All controls: navigation links, install/copy actions, command controls, focus states, locks/eyelet-inspired control treatments, and any pan/zoom controls.
- All cords: every gold route, host feed, gathered path, focus trace, reveal, loop, connector, and endpoint must be authored SVG/CSS/DOM—not baked into the texture.
- All flow diagrams: the vertical orchestration loom, Shape Work lifecycle, Do Work lifecycle, nodes, branches, return/remediation loops, human gates, verification paths, and ready-change outcomes.

