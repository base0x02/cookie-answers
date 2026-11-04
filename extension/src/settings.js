// Shared settings model for the background script and popup.

export const api = globalThis.browser ?? globalThis.chrome;

/**
 * mode:        what to answer on known consent banners
 *                'optOut' = reject everything that isn't strictly necessary
 *                'optIn'  = accept all
 *                'off'    = leave banners alone
 * heuristics:  what to do with banners no rule recognises (only used with optOut)
 *                'off'    = leave them alone
 *                'reject' = click a "reject" button if one exists
 *                'tier1'  = reject, or otherwise click an "OK / got it" acknowledge button
 * cosmetic:    hide banners that can only be hidden (no real choice to make)
 * siteModes:   per-site override of `mode`, keyed by registrable-ish hostname
 */
export const DEFAULT_SETTINGS = Object.freeze({
    mode: 'optOut',
    heuristics: 'reject',
    cosmetic: true,
    siteModes: {},
});

export async function getSettings() {
    const { settings } = await api.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}), siteModes: { ...(settings?.siteModes || {}) } };
}

export async function saveSettings(settings) {
    await api.storage.local.set({ settings });
}

/** Normalise a URL to the key used for per-site overrides ("www." stripped). */
export function siteKey(url) {
    try {
        const { hostname, protocol } = new URL(url);
        if (!/^https?:$/.test(protocol)) return null;
        return hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * Turns the raw timestamps recorded for a tab into ms since the page started loading.
 * Missing values stay undefined.
 */
export function summarizeTiming(status) {
    const t = status?.timing;
    if (!t?.navStart) return {};
    const rel = (v) => (v ? Math.max(0, Math.round(v - t.navStart)) : undefined);
    const work = Object.values(status.work || {}).reduce((a, b) => a + b, 0);
    const parts = Object.values(status.workParts || {});
    const sumPart = (k) => (parts.length ? parts.reduce((a, p) => a + (p?.[k] || 0), 0) : undefined);
    return {
        firstPaint: rel(t.fcp),
        domReady: rel(t.dcl),
        loaded: rel(t.load),
        extStart: rel(t.extStart),
        extReady: rel(t.extReady),
        bannerFound: rel(t.bannerFound),
        bannerDone: rel(t.bannerDone),
        extWork: status.work ? work : undefined,
        // main-thread work done before the page's load event (the part that can delay loading)
        extWorkBeforeLoad: sumPart('beforeLoad'),
        workOwn: sumPart('own'),
        workDom: sumPart('dom'),
        workHeur: sumPart('heur'),
    };
}

/** Mode for a page, honouring overrides on the host or any parent domain. */
export function effectiveMode(settings, url) {
    const host = siteKey(url);
    if (host) {
        const parts = host.split('.');
        for (let i = 0; i < parts.length - 1; i++) {
            const candidate = parts.slice(i).join('.');
            if (settings.siteModes[candidate]) return settings.siteModes[candidate];
        }
    }
    return settings.mode;
}
