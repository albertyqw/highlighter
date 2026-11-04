# Bundled PDF.js

Mozilla PDF.js, `pdfjs-dist` version **6.5.438**, from the official npm package.
Project: https://mozilla.github.io/pdf.js/
Source: https://github.com/mozilla/pdf.js
License: Apache-2.0, included in LICENSE. Fonts, CMaps, colour profiles and WASM
retain their additional license files in their respective directories.

Archive integrity (npm SHA-512):
`sha512-vg8Pw1x+AFKy4AMDvhuWl5cOYV8d698UoEANoFFhc79hqXDnZQqnOXoxw3HG907WHOg1JYOvLhP756boddFxpA==`

To refresh, obtain `npm pack pdfjs-dist@6.5.438` in a scratch directory. Copy
`build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, and `build/pdf.renderer.min.mjs`
here as `pdf.mjs`, `pdf.worker.mjs`, and `pdf.renderer.mjs`; copy LICENSE and the
cmaps, standard_fonts, wasm, and iccs directories. text-layer.css is the license
header and the first `.textLayer` rule from `web/pdf_viewer.css`, ending before
`.textLayerImages`. The rest of Mozilla's viewer is not used.

All executable code, fonts, CMaps and decoders are bundled. No executable code is
downloaded from a CDN. PDF JavaScript actions and XFA are not enabled.
