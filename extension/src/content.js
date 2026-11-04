// Runs in every frame (isolated world). Hosts the autoconsent engine and relays
// its messages to the background script.
//
// Request/response messages (init -> initResp, eval -> evalResp) come back as the
// return value of runtime.sendMessage instead of a separate tabs.sendMessage, which
// avoids relying on per-frame tab messaging in Safari.
import { scriptStart as t0 } from './start-time.js';
import AutoConsent from '@duckduckgo/autoconsent';

const api = globalThis.browser ?? globalThis.chrome;
const isTop = window === window.top;

let consent = null;
let selfTestScheduled = false;

// ---- timing ----
// Absolute times (epoch ms) so iframe and top-frame measurements can be compared:
// each frame's performance.now() counts from its own start.
const abs = (t = performance.now()) => Math.round(performance.timeOrigin + t);
const timing = { navStart: Math.round(performance.timeOrigin), extStart: abs(t0) };
let ownWorkMs = 0; // synchronous main-thread time spent in this script outside the engine's own measures

let domWorkMs = 0; // synchronous time inside the engine's DOM helpers (rule detection, clicks, hiding)
let workBeforeLoad = null; // total work at the page's load event: the part that can delay loading

function engineWorkMs() {
    // Heuristic page scans, recorded by autoconsent when performanceLoggingEnabled is set.
    // Both are synchronous, so their durations are main-thread time. (parseDeclarativeRules is
    // already inside ownWorkMs; findCmp_* is elapsed time including waits, so it's not used.)
    const names = /^(detectHeuristics|heuristicDetector)$/;
    return performance
        .getEntriesByType('measure')
        .filter((m) => names.test(m.name))
        .reduce((sum, m) => sum + m.duration, 0);
}

// The engine's rule steps all go through these synchronous DOM helpers (including calls
// the helpers make to each other), so timing them captures its detection work.
const SYNC_DOM_METHODS = [
    'elementExists', 'elementVisible', 'elementSelector', 'querySingleReplySelector', 'querySelectorChain',
    'cookieContains', 'hide', 'stylesheet', 'removeClass', 'setStyle', 'addStyle', 'prehide', 'undoPrehide',
];
function instrumentDomActions(domActions) {
    let depth = 0; // only time the outermost call, so nested helpers aren't counted twice
    for (const name of SYNC_DOM_METHODS) {
        const fn = domActions[name];
        if (typeof fn !== 'function') continue;
        domActions[name] = function (...args) {
            if (depth++ > 0) {
                try { return fn.apply(this, args); } finally { depth--; }
            }
            const s = performance.now();
            try {
                return fn.apply(this, args);
            } finally {
                domWorkMs += performance.now() - s;
                depth--;
            }
        };
    }
}

function reportTiming(extra = {}) {
    if (isTop) {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav?.domContentLoadedEventEnd) timing.dcl = abs(nav.domContentLoadedEventEnd);
        if (nav?.loadEventEnd) timing.load = abs(nav.loadEventEnd);
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        if (fcp) timing.fcp = abs(fcp.startTime);
    }
    const heur = engineWorkMs();
    const workMs = Math.round(ownWorkMs + domWorkMs + heur);
    const parts = { own: Math.round(ownWorkMs), dom: Math.round(domWorkMs), heur: Math.round(heur), beforeLoad: workBeforeLoad };
    const msg = { type: 'timing', timing: { ...timing, ...extra }, workMs, parts };
    api.runtime.sendMessage(msg).catch(() => {});
}

// ---- messaging ----

async function send(message) {
    if (message.type === 'optOutResult' || message.type === 'optInResult') {
        selfTestScheduled = message.result && message.scheduleSelfTest;
    }
    if (message.type === 'popupFound' || message.type === 'autoconsentDone') {
        message.at = abs();
    }

    let response;
    try {
        response = await api.runtime.sendMessage(message);
    } catch (e) {
        // Background unavailable (e.g. extension reloaded): nothing useful to do.
        return;
    }

    if (response && response.type && consent) {
        const s = performance.now();
        const pending = consent.receiveMessageCallback(response); // sync part: config + rule parsing
        ownWorkMs += performance.now() - s;
        if (response.type === 'initResp') timing.extReady = abs();
        await pending;
    }

    if (message.type === 'autoconsentDone') {
        reportTiming();
        if (selfTestScheduled && consent) {
            selfTestScheduled = false;
            // Give the CMP a moment to persist its consent before verifying.
            setTimeout(() => consent.receiveMessageCallback({ type: 'selfTest' }), 1000);
        }
    }
}

// Only http(s) documents; skip about:blank, extension pages, etc.
if (/^https?:$/.test(location.protocol)) {
    consent = new AutoConsent(send);
    instrumentDomActions(consent.domActions);
    ownWorkMs += performance.now() - t0;

    // Report once the page has loaded (and painted), and again later to catch late detection work.
    const afterLoad = () => {
        workBeforeLoad = Math.round(ownWorkMs + domWorkMs + engineWorkMs());
        setTimeout(reportTiming, 300);
        setTimeout(reportTiming, 8000);
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
}
