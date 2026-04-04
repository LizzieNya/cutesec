const fs = require('fs');

let css = fs.readFileSync('src/styles.css', 'utf8');

// Replace exact HEX and named colors
css = css.replace(/#ff69b4/gi, 'var(--accent)');
css = css.replace(/#8a2be2/gi, 'var(--accent-2)');
css = css.replace(/#dda0dd/gi, 'var(--bubble-sent)');
css = css.replace(/#ffb6c1/gi, 'var(--border-soft)');

// Replace RGBA for accent
css = css.replace(/rgba\(\s*255\s*,\s*105\s*,\s*180\s*,\s*([0-9.]+)\s*\)/g, (match, p1) => {
    let pct = Math.round(parseFloat(p1) * 100);
    return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
});

// Replace RGBA for accent-2
css = css.replace(/rgba\(\s*138\s*,\s*43\s*,\s*226\s*,\s*([0-9.]+)\s*\)/g, (match, p1) => {
    let pct = Math.round(parseFloat(p1) * 100);
    return `color-mix(in srgb, var(--accent-2) ${pct}%, transparent)`;
});

// Replace RGBA for bubble-sent (plum)
css = css.replace(/rgba\(\s*221\s*,\s*160\s*,\s*221\s*,\s*([0-9.]+)\s*\)/g, (match, p1) => {
    let pct = Math.round(parseFloat(p1) * 100);
    return `color-mix(in srgb, var(--bubble-sent) ${pct}%, transparent)`;
});

// Replace RGBA for border-soft (lightpink) -> mapped to accent for opacity
css = css.replace(/rgba\(\s*255\s*,\s*182\s*,\s*193\s*,\s*([0-9.]+)\s*\)/g, (match, p1) => {
    let pct = Math.round(parseFloat(p1) * 100);
    return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
});

// Replace dark mode purple accents: rgba(180, 140, 220, ...) -> color-mix on accent-2
css = css.replace(/rgba\(\s*180\s*,\s*140\s*,\s*220\s*,\s*([0-9.]+)\s*\)/g, (match, p1) => {
    let pct = Math.round(parseFloat(p1) * 100);
    return `color-mix(in srgb, var(--accent-2) ${pct}%, transparent)`;
});

// Replace hex #cfbddf
css = css.replace(/#cfbddf/g, 'color-mix(in srgb, var(--text-primary) 80%, var(--accent))');
css = css.replace(/#f0c7e7/g, 'color-mix(in srgb, var(--text-primary) 95%, var(--accent))');

// Update :root to NOT have circular references
css = css.replace(/--ui-focus-ring: [^;]+;/, '--ui-focus-ring: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);');
css = css.replace(/--accent-soft: [^;]+;/, '--accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);');
css = css.replace(/--border-soft: [^;]+;/, '--border-soft: color-mix(in srgb, var(--accent-border) 45%, transparent);');
css = css.replace(/--accent-border: [^;]+;/, '--accent-border: color-mix(in srgb, var(--accent) 45%, transparent);');

fs.writeFileSync('src/styles.css', css);
console.log('done');
