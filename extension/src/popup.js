import { api, getSettings, saveSettings, siteKey, effectiveMode, summarizeTiming } from './settings.js';

const $ = (id) => document.getElementById(id);

const MODE_LABEL = { optOut: 'reject', optIn: 'accept all', off: 'do nothing' };

function describe(status, mode) {
    if (mode === 'off') return { cls: 'idle', text: 'Turned off for this site', detail: '' };
    if (!status) return { cls: 'idle', text: 'No status yet', detail: 'Reload the page to check for a banner.' };
    const cmp = status.cmp ? `via ${status.cmp}` : '';
    switch (status.state) {
        case 'done':
            return {
                cls: 'done',
                text: mode === 'optIn' ? 'Accepted cookie banner' : 'Rejected cookie banner',
                detail: [cmp, status.verified === true ? 'verified' : ''].filter(Boolean).join(' · '),
            };
        case 'hidden':
            return { cls: 'done', text: 'Hid cookie banner', detail: cmp };
        case 'found':
            return { cls: 'found', text: 'Banner found, answering…', detail: cmp };
        case 'failed':
            return { cls: 'failed', text: 'Couldn’t answer banner', detail: cmp };
        default:
            return { cls: 'idle', text: 'No cookie banner handled', detail: `Default: ${MODE_LABEL[mode]}` };
    }
}

const fmt = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

function renderTiming(status) {
    const t = summarizeTiming(status);
    if (t.extStart == null && t.loaded == null) return;
    $('timing').hidden = false;

    const rows = [
        ['ext', 'Extension ready', t.extReady, t.extStart != null ? `started at ${fmt(t.extStart)}` : ''],
        ['paint', 'Page first paint', t.firstPaint],
        ['banner', 'Banner answered', t.bannerDone],
        ['load', 'Page fully loaded', t.loaded],
    ];
    const list = $('timing-list');
    list.replaceChildren();
    for (const [cls, label, value, hint] of rows) {
        if (value == null && cls === 'banner') continue;
        const dt = document.createElement('dt');
        dt.className = cls;
        dt.textContent = label;
        if (hint) dt.title = hint;
        const dd = document.createElement('dd');
        dd.textContent = fmt(value);
        list.append(dt, dd);
    }
    // Main-thread time the extension used, split at the page's load event: only the
    // first part can have delayed loading; the rest happens while answering the banner.
    const before = t.extWorkBeforeLoad;
    const after = t.extWork != null && before != null ? Math.max(0, t.extWork - before) : null;
    for (const [label, value] of [
        ['Extension work before load', before ?? t.extWork],
        ['Extension work after load', after],
    ]) {
        if (value == null) continue;
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = fmt(value);
        list.append(dt, dd);
    }

    // timeline: 0 .. the latest event
    const end = Math.max(t.loaded || 0, t.bannerDone || 0, t.firstPaint || 0, 1);
    const place = (id, v) => {
        const el = $(id);
        el.hidden = v == null;
        if (v != null) el.style.left = `${Math.min(100, (v / end) * 100)}%`;
    };
    place('tl-ext', t.extReady);
    place('tl-paint', t.firstPaint);
    place('tl-banner', t.bannerDone);
    place('tl-load', t.loaded);

    // verdict: the most the extension can have delayed this page's load
    if (before != null && t.loaded) {
        const pct = (before / t.loaded) * 100;
        const level = before < 50 || pct < 3 ? 'Negligible' : pct < 8 ? 'Small' : 'Noticeable';
        $('timing-verdict').textContent = `${level} impact: delayed loading by at most ${fmt(before)} (${pct.toFixed(1)}%).`;
    }
}

async function main() {
    const settings = await getSettings();
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const site = tab?.url ? siteKey(tab.url) : null;

    $('mode').value = settings.mode;
    $('heuristics').value = settings.heuristics;
    $('cosmetic').checked = settings.cosmetic;

    if (site) {
        $('page').hidden = false;
        $('site').textContent = site;
        $('site-mode').value = settings.siteModes[site] || '';

        const key = `status-${tab.id}`;
        const status = (await api.storage.session.get(key))[key];
        const d = describe(status, effectiveMode(settings, tab.url));
        $('status-dot').className = `dot ${d.cls}`;
        $('status-text').textContent = d.text;
        $('status-detail').textContent = d.detail;
        renderTiming(status);
    }

    const save = async (mutate, affectsPage) => {
        const s = await getSettings();
        mutate(s);
        await saveSettings(s);
        if (affectsPage && site) $('reload-hint').hidden = false;
    };

    $('site-mode').addEventListener('change', (e) =>
        save((s) => {
            if (e.target.value) s.siteModes[site] = e.target.value;
            else delete s.siteModes[site];
        }, true),
    );
    $('mode').addEventListener('change', (e) => save((s) => (s.mode = e.target.value), true));
    $('heuristics').addEventListener('change', (e) => save((s) => (s.heuristics = e.target.value), true));
    $('cosmetic').addEventListener('change', (e) => save((s) => (s.cosmetic = e.target.checked), true));
}

main();
