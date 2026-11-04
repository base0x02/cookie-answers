// Non-persistent background page: supplies config + rules to each frame, runs
// main-world eval snippets, and records per-tab status for the popup and badge.
import { filterCompactRules, evalSnippets } from '@duckduckgo/autoconsent';
import { api, getSettings, effectiveMode, summarizeTiming } from './settings.js';

let compactRulesPromise = null;
let fullRulesPromise = null;

function loadJSON(path) {
    return fetch(api.runtime.getURL(path)).then((r) => r.json());
}
const compactRules = () => (compactRulesPromise ??= loadJSON('compact-rules.json'));
const fullRules = () => (fullRulesPromise ??= loadJSON('rules.json').then((r) => r.autoconsent));
// extension/rules/*.json, inlined at build time
const localRules = async () => __LOCAL_RULES__;

// ---- per-tab status (storage.session survives background page unloads) ----

const statusKey = (tabId) => `status-${tabId}`;

async function getStatus(tabId) {
    return (await api.storage.session.get(statusKey(tabId)))[statusKey(tabId)] || null;
}

// Debug builds (`npm run build:debug`) mirror status changes to the native app's
// unified log, so they can be observed from the host while testing in a simulator.
function debugLog(event) {
    if (!__DEBUG__) return;
    try {
        api.runtime.sendNativeMessage('application.id', event).catch(() => {});
    } catch {
        // native messaging unavailable
    }
}

// Messages from several frames arrive concurrently; chain each tab's read-modify-write
// so one update can't overwrite another.
const statusQueues = new Map();

/** `patch` is an object to merge, or a function prev => partial update. */
function setStatus(tabId, patch, { replace = false, log = true } = {}) {
    const run = async () => {
        const prev = replace ? {} : (await getStatus(tabId)) || {};
        const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch), updated: Date.now() };
        if (log) debugLog({ tabId, ...next, timing: undefined, work: undefined, ...summarizeTiming(next) });
        await api.storage.session.set({ [statusKey(tabId)]: next });
        await updateBadge(tabId, next);
        return next;
    };
    const result = (statusQueues.get(tabId) || Promise.resolve()).then(run, run);
    statusQueues.set(tabId, result.catch(() => {}));
    return result;
}

const BADGES = {
    done: { text: '✓', color: '#2e7d32' },
    hidden: { text: '–', color: '#6d6d6d' },
    failed: { text: '!', color: '#c62828' },
};

async function updateBadge(tabId, status) {
    const badge = BADGES[status?.state];
    try {
        await api.action.setBadgeText({ tabId, text: badge ? badge.text : '' });
        if (badge) await api.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    } catch {
        // tab may be gone
    }
}

api.tabs.onRemoved.addListener((tabId) => api.storage.session.remove(statusKey(tabId)));

// ---- message handling ----

function buildConfig(settings, mode) {
    const optOut = mode === 'optOut';
    return {
        enabled: mode !== 'off',
        autoAction: mode === 'off' ? null : mode,
        enablePrehide: mode !== 'off',
        enableCosmeticRules: settings.cosmetic,
        enableGeneratedRules: true,
        enableHeuristicDetection: optOut && settings.heuristics !== 'off',
        heuristicMode: optOut ? settings.heuristics : 'off',
        enablePopupMutationObserver: true,
        performanceLoggingEnabled: true, // feeds the "extension work" figure in the popup
        detectRetries: 20,
        isMainWorld: false,
        prehideTimeout: 2000,
        logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: true, messages: false, waits: false },
    };
}

const patternCache = new Map();
function urlMatches(pattern, url) {
    if (!patternCache.has(pattern)) patternCache.set(pattern, new RegExp(pattern));
    return patternCache.get(pattern).test(url);
}

/** Same idea as filterCompactRules: drop rules that can't apply to this frame (~1MB -> ~340KB). */
function filterFullRules(rules, url, mainFrame) {
    return rules.filter((r) => {
        const ctx = r.runContext || {};
        if (ctx.urlPattern && !urlMatches(ctx.urlPattern, url)) return false;
        return mainFrame ? ctx.main !== false : ctx.frame === true;
    });
}

async function handleInit(msg, sender) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    const mainFrame = frameId === 0;
    const frameUrl = sender.url || msg.url;
    // Per-site choices follow the top-level page, so a CMP iframe obeys the site setting.
    const pageUrl = sender.tab?.url || frameUrl;

    const settings = await getSettings();
    const mode = effectiveMode(settings, pageUrl);

    if (mainFrame && tabId != null) {
        await setStatus(tabId, { state: 'idle', mode, url: pageUrl }, { replace: true, log: false });
        debugLog({ tabId, state: 'init', mode, url: pageUrl });
    }

    let rules;
    if (mode === 'off') {
        rules = { autoconsent: [] };
    } else {
        // local rules (extension/rules/) replace upstream rules of the same name
        const forMode = (await localRules()).filter((r) => mode === 'optIn' || !r.optInOnly);
        const local = filterFullRules(forMode, frameUrl, mainFrame);
        const overridden = new Set((await localRules()).map((r) => r.name));
        if (mode === 'optIn') {
            // compact rules carry no opt-in steps, so use the full rules, trimmed to this frame
            const upstream = filterFullRules(await fullRules(), frameUrl, mainFrame).filter((r) => !overridden.has(r.name));
            rules = { autoconsent: [...upstream, ...local] };
        } else {
            const compact = filterCompactRules(await compactRules(), { url: frameUrl, mainFrame });
            compact.r = compact.r.filter((r) => !overridden.has(r[1])); // r[1] is the rule name
            rules = { autoconsent: local, compact };
        }
    }

    const resp = { type: 'initResp', rules, config: buildConfig(settings, mode) };
    if (__DEBUG__ && mainFrame) debugLog({ tabId, state: 'initResp', bytes: JSON.stringify(resp).length });
    return resp;
}

async function handleEval(msg, sender) {
    const func = evalSnippets[msg.snippetId];
    if (!func) return { type: 'evalResp', id: msg.id, result: false };
    try {
        const [res] = await api.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
            world: 'MAIN',
            func,
        });
        return { type: 'evalResp', id: msg.id, result: res?.result };
    } catch (e) {
        console.warn('eval failed', msg.snippetId, e);
        return { type: 'evalResp', id: msg.id, result: false };
    }
}

async function handleMessage(msg, sender) {
    const tabId = sender.tab?.id;
    switch (msg.type) {
        case 'init':
            return handleInit(msg, sender);
        case 'eval':
            return handleEval(msg, sender);
        case 'popupFound':
            if (tabId != null) {
                await setStatus(tabId, (prev) => ({ state: 'found', cmp: msg.cmp, timing: { ...prev.timing, bannerFound: msg.at } }));
            }
            return null;
        case 'timing':
            if (tabId != null) {
                const frameId = sender.frameId ?? 0;
                await setStatus(
                    tabId,
                    (prev) => ({
                        // page timings only come from the top frame; work is summed over all frames
                        timing: frameId === 0 ? { ...prev.timing, ...msg.timing } : prev.timing,
                        work: { ...prev.work, [frameId]: msg.workMs },
                        workParts: { ...prev.workParts, [frameId]: msg.parts },
                    }),
                    { log: frameId === 0 },
                );
            }
            return null;
        case 'optOutResult':
        case 'optInResult':
            if (tabId != null && !msg.result) await setStatus(tabId, { state: 'failed', cmp: msg.cmp });
            return null;
        case 'autoconsentDone':
            if (tabId != null) {
                await setStatus(tabId, (prev) => ({
                    state: msg.isCosmetic ? 'hidden' : 'done',
                    cmp: msg.cmp,
                    clicks: msg.totalClicks,
                    timing: { ...prev.timing, bannerDone: msg.at },
                }));
            }
            return null;
        case 'selfTestResult':
            if (tabId != null) await setStatus(tabId, { verified: msg.result });
            return null;
        case 'autoconsentError':
            console.error('autoconsent error', msg.details);
            return null;
        case 'cmpDetected':
            debugLog({ tabId, state: 'cmpDetected', cmp: msg.cmp, url: msg.url });
            return null;
        case 'report':
            if (__DEBUG__ && msg.mainFrame) debugLog({ tabId, state: `report:${msg.state.lifecycle}`, cmps: msg.state.detectedCmps.join(',') });
            return null;
        default:
            // visualDelay: nothing to do
            return null;
    }
}

api.runtime.onMessage.addListener((msg, sender) => {
    if (!sender.tab) return undefined; // popup/options talk to storage directly
    return handleMessage(msg, sender);
});
