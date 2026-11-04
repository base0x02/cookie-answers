// Builds the web extension into ./dist (referenced in place by the Xcode project).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const out = 'dist';
const watch = process.argv.includes('--watch');
const debug = process.argv.includes('--debug');

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/icons`, { recursive: true });

cpSync('static', out, { recursive: true });
if (debug) {
    // native messaging is only needed for the debug log channel
    const manifest = JSON.parse(readFileSync(`${out}/manifest.json`, 'utf8'));
    manifest.permissions.push('nativeMessaging');
    writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 4));
}
cpSync(require.resolve('@duckduckgo/autoconsent/rules/compact-rules.json'), `${out}/compact-rules.json`);
cpSync(require.resolve('@duckduckgo/autoconsent/rules/rules.json'), `${out}/rules.json`);

// Local rules (./rules/*.json) replace upstream rules with the same name, or add new ones.
// They're bundled into background.js: the Xcode project lists dist/ files one by one,
// so a new file in dist/ would silently be left out of the app.
const localRules = readdirSync('rules')
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
        const { _comment, ...rule } = JSON.parse(readFileSync(`rules/${f}`, 'utf8'));
        return rule;
    });

const opts = {
    entryPoints: { content: 'src/content.js', background: 'src/background.js', popup: 'src/popup.js' },
    outdir: out,
    bundle: true,
    format: 'iife',
    target: ['safari16'],
    legalComments: 'none',
    define: { __DEBUG__: JSON.stringify(debug), __LOCAL_RULES__: JSON.stringify(localRules) },
    logLevel: 'info',
};

// ---- icons: a cookie with a check mark, rendered without external deps ----

function png(size, draw) {
    const px = new Uint8Array(size * size * 4);
    const ss = 4; // supersampling for anti-aliasing
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const c = draw((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
                    if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
                }
            }
            const i = (y * size + x) * 4;
            const n = ss * ss;
            px[i + 3] = Math.round((a / n) * 255);
            if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
        }
    }
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

const distSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function cookie(mono) {
    const chips = [[0.36, 0.33, 0.06], [0.62, 0.30, 0.05], [0.30, 0.60, 0.05], [0.70, 0.55, 0.045]];
    return (x, y) => {
        const d = Math.hypot(x - 0.5, y - 0.5);
        const bite = Math.hypot(x - 0.86, y - 0.16) < 0.17;
        const check = distSeg(x, y, 0.37, 0.68, 0.47, 0.78) < 0.055 || distSeg(x, y, 0.47, 0.78, 0.70, 0.52) < 0.055;
        if (d > 0.46 || bite) return null;
        if (mono) {
            // toolbar template-style: solid shape, check punched out
            return check ? null : [0, 0, 0, 1];
        }
        if (check) return [255, 255, 255, 1];
        if (chips.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r)) return [92, 54, 25, 1];
        return d > 0.43 ? [176, 112, 52, 1] : [214, 151, 82, 1];
    };
}

for (const s of [48, 96, 128, 256, 512]) writeFileSync(`${out}/icons/icon-${s}.png`, png(s, cookie(false)));
for (const s of [16, 32]) writeFileSync(`${out}/icons/toolbar-${s}.png`, png(s, cookie(false)));

if (watch) {
    const { context } = await import('esbuild');
    const ctx = await context(opts);
    await ctx.watch();
} else {
    await build(opts);
}
