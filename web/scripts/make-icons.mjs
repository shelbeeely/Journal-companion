// Regenerates PWA icons from the Android launcher artwork (requires ImageMagick `convert`).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../app/src/main/res/drawable/ic_launcher_companion_clean.png');
const out = path.resolve(here, '../public/icons');
const bg = '#285744';

const run = (args) => execFileSync('convert', args, { stdio: 'inherit' });

// The source artwork is already full-bleed (opaque corners), so it doubles as the maskable icon.
for (const size of [192, 512]) {
  run([src, '-resize', `${size}x${size}`, path.join(out, `icon-${size}.png`)]);
}
// Maskable + Apple touch: full-bleed square so OS masks never show transparent corners.
for (const [name, size] of [['maskable-512.png', 512], ['maskable-192.png', 192], ['apple-touch-icon.png', 180]]) {
  run([src, '-background', bg, '-flatten', '-resize', `${size}x${size}`, path.join(out, name)]);
}
run([src, '-resize', '64x64', path.join(out, 'favicon-64.png')]);
