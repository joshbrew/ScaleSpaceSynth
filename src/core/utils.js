export function sanitizeName(s, opts = {}) {
    const maxLen = opts.maxLen || 64;
    return String(s || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, maxLen);
}
