(function (global) {
    'use strict';
    const PREFIX = 'eraAiCache:';
    const MAX_ENTRIES = 80;
    const TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const TRACKING_PARAM = /^(utm_|spm$|spm_|from$|from_|share|ref$|ref_|fbclid$|gclid$|yclid$|_)/i;
    function normalizeUrl(url) {
        const raw = String(url || '');
        try {
            const u = new URL(raw);
            u.hash = '';
            const keep = [];
            u.searchParams.forEach(function (v, k) {
                if (!TRACKING_PARAM.test(k))
                    keep.push([k, v]);
            });
            keep.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
            const qs = keep.map(function (p) {
                return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
            }).join('&');
            return u.origin + u.pathname + (qs ? '?' + qs : '');
        }
        catch (e) {
            return raw.split('#')[0];
        }
    }
    function hashText(str) {
        const s = String(str || '');
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return s.length.toString(36) + '-' + h.toString(36);
    }
    function keyFor(url, model) {
        return PREFIX + String(model || 'default') + '|' + normalizeUrl(url);
    }
    function chromeStore() {
        return {
            get: function (key) {
                return new Promise(function (r) { chrome.storage.local.get(key, function (v) { r(v || {}); }); });
            },
            getAll: function () {
                return new Promise(function (r) { chrome.storage.local.get(null, function (v) { r(v || {}); }); });
            },
            set: function (obj) {
                return new Promise(function (r) { chrome.storage.local.set(obj, function () { r(); }); });
            },
            remove: function (keys) {
                return new Promise(function (r) { chrome.storage.local.remove(keys, function () { r(); }); });
            }
        };
    }
    function localStorageStore(namespace) {
        const ns = namespace || PREFIX;
        function readAll() {
            const out = {};
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.indexOf(ns) === 0)
                        out[k] = JSON.parse(localStorage.getItem(k));
                }
            }
            catch (e) { }
            return out;
        }
        function writeAll(all) {
            try {
                for (const k of Object.keys(all))
                    localStorage.setItem(k, JSON.stringify(all[k]));
            }
            catch (e) { }
        }
        return {
            get: function (key) {
                const v = readAll()[key];
                return Promise.resolve(v === undefined ? {} : (function () { const o = {}; o[key] = v; return o; })());
            },
            getAll: function () { return Promise.resolve(readAll()); },
            set: function (obj) { writeAll(obj); return Promise.resolve(); },
            remove: function (keys) {
                const list = Array.isArray(keys) ? keys : [keys];
                try {
                    for (const k of list)
                        localStorage.removeItem(k);
                }
                catch (e) { }
                return Promise.resolve();
            }
        };
    }
    function create(store) {
        const st = store || chromeStore();
        async function prune() {
            const all = await st.getAll();
            const now = Date.now();
            const entries = [];
            for (const k of Object.keys(all)) {
                if (k.indexOf(PREFIX) !== 0)
                    continue;
                entries.push({ key: k, ts: (all[k] && all[k].ts) || 0 });
            }
            const dead = entries.filter(function (e) { return now - e.ts > TTL_MS; });
            const alive = entries
                .filter(function (e) { return now - e.ts <= TTL_MS; })
                .sort(function (a, b) { return b.ts - a.ts; });
            const overflow = alive.slice(MAX_ENTRIES);
            const remove = dead.concat(overflow).map(function (e) { return e.key; });
            if (remove.length)
                await st.remove(remove);
            return remove.length;
        }
        return {
            async lookup(url, model, text) {
                const key = keyFor(url, model);
                const raw = await st.get(key);
                const entry = raw && raw[key];
                if (!entry || !Array.isArray(entry.results))
                    return null;
                if (Date.now() - entry.ts > TTL_MS) {
                    await st.remove(key);
                    return null;
                }
                if (entry.textHash === hashText(text)) {
                    return { entry: entry, results: entry.results, exact: true, dropped: 0 };
                }
                const alive = entry.results.filter(function (r) {
                    return r && r.text && text.indexOf(r.text) !== -1;
                });
                if (!alive.length)
                    return null;
                return {
                    entry: entry,
                    results: alive,
                    exact: false,
                    dropped: entry.results.length - alive.length
                };
            },
            async save(url, model, text, results, title) {
                const entry = {
                    url: normalizeUrl(url),
                    model: model || '',
                    ts: Date.now(),
                    textHash: hashText(text),
                    title: String(title || '').slice(0, 200),
                    results: Array.isArray(results) ? results : []
                };
                const obj = {};
                obj[keyFor(url, model)] = entry;
                await st.set(obj);
                await prune();
                return entry;
            },
            async drop(url, model) {
                await st.remove(keyFor(url, model));
            },
            async clear() {
                const all = await st.getAll();
                const keys = Object.keys(all).filter(function (k) { return k.indexOf(PREFIX) === 0; });
                if (keys.length)
                    await st.remove(keys);
                return keys.length;
            },
            async stats() {
                const all = await st.getAll();
                const now = Date.now();
                let count = 0;
                let expired = 0;
                let newest = 0;
                let snippets = 0;
                let bytes = 0;
                for (const k of Object.keys(all)) {
                    if (k.indexOf(PREFIX) !== 0)
                        continue;
                    const e = all[k];
                    if (!e || now - (e.ts || 0) > TTL_MS) {
                        expired++;
                        continue;
                    }
                    count++;
                    newest = Math.max(newest, e.ts || 0);
                    snippets += (e.results || []).length;
                    bytes += JSON.stringify(e).length;
                }
                return { count: count, expired: expired, newest: newest, snippets: snippets, bytes: bytes };
            },
            prune: prune
        };
    }
    global.EraCache = {
        PREFIX: PREFIX,
        MAX_ENTRIES: MAX_ENTRIES,
        TTL_MS: TTL_MS,
        normalizeUrl: normalizeUrl,
        hashText: hashText,
        keyFor: keyFor,
        chromeStore: chromeStore,
        localStorageStore: localStorageStore,
        create: create
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
