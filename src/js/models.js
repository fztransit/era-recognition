(function (global) {
    'use strict';
    const CUSTOM_ID = 'custom';
    const ADD_ID = '__add__';
    const PRESETS = [
        {
            id: 'deepseek-flash', label: 'DeepSeek Flash', note: '深度求索',
            model: 'deepseek-flash', apiBase: 'https://api.deepseek.com'
        },
        {
            id: CUSTOM_ID, label: '其他（自定义）', note: '', model: '', apiBase: '',
            custom: true, hidden: true
        }
    ];
    const DEFAULT_ID = PRESETS[0].id;
    function str(v) {
        return v == null ? '' : String(v).trim();
    }
    function byId(id, customs) {
        const key = str(id);
        const p = PRESETS.filter(function (x) { return x.id === key; })[0];
        if (p)
            return p;
        for (const c of customs || []) {
            if (c && str(c.id) === key) {
                return { id: c.id, label: c.label || c.id, note: '', custom: true };
            }
        }
        return null;
    }
    function isCustom(id) {
        return str(id) === CUSTOM_ID;
    }
    function defaultProfile(id) {
        const p = byId(id) || byId(DEFAULT_ID);
        return { apiBase: p.apiBase || '', apiKey: '', model: p.model || '' };
    }
    function emptyProfiles() {
        const out = {};
        for (const p of PRESETS)
            out[p.id] = defaultProfile(p.id);
        return out;
    }
    function matchPresetByBase(apiBase) {
        const base = str(apiBase).replace(/\/+$/, '').toLowerCase();
        if (base.length < 12)
            return null;
        return PRESETS.filter(function (p) {
            if (p.custom || !p.apiBase)
                return false;
            const cand = p.apiBase.replace(/\/+$/, '').toLowerCase();
            return cand === base || base.indexOf(cand) === 0 || cand.indexOf(base) === 0;
        })[0] || null;
    }
    function matchPresetByModel(model) {
        const m = str(model).toLowerCase();
        if (!m)
            return null;
        return PRESETS.filter(function (p) {
            return !p.custom && p.model && p.model.toLowerCase() === m;
        })[0] || null;
    }
    function normalize(raw) {
        const src = raw || {};
        const saved = (src.apiProfiles && typeof src.apiProfiles === 'object') ? src.apiProfiles : {};
        const profiles = {};
        for (const p of PRESETS) {
            const cur = (saved[p.id] && typeof saved[p.id] === 'object') ? saved[p.id] : {};
            profiles[p.id] = {
                apiBase: str(cur.apiBase) || p.apiBase || '',
                apiKey: str(cur.apiKey),
                model: str(cur.model) || p.model || ''
            };
        }
        const customs = [];
        const known = new Set();
        for (const c of (Array.isArray(src.customModels) ? src.customModels : [])) {
            const id = str(c && c.id);
            if (!id || known.has(id))
                continue;
            known.add(id);
            const cur = (saved[id] && typeof saved[id] === 'object') ? saved[id] : {};
            profiles[id] = { apiBase: str(cur.apiBase), apiKey: str(cur.apiKey), model: str(cur.model) };
            customs.push({ id: id, label: str(c.label) || id });
        }
        for (const id of Object.keys(saved)) {
            if (known.has(id) || byId(id))
                continue;
            const cur = saved[id];
            if (!cur || typeof cur !== 'object')
                continue;
            known.add(id);
            profiles[id] = { apiBase: str(cur.apiBase), apiKey: str(cur.apiKey), model: str(cur.model) };
            customs.push({ id: id, label: str(cur.label) || id });
        }
        let activeId = str(src.activeModelId);
        if (!byId(activeId, customs) && !known.has(activeId)) {
            const legacyBase = str(src.apiBase);
            const legacyModel = str(src.model);
            const legacyKey = str(src.apiKey);
            if (!legacyBase && !legacyModel && !legacyKey) {
                activeId = DEFAULT_ID;
            }
            else {
                const guess = matchPresetByBase(legacyBase) ||
                    (legacyBase ? null : matchPresetByModel(legacyModel));
                activeId = guess ? guess.id : CUSTOM_ID;
                profiles[activeId] = {
                    apiBase: legacyBase || profiles[activeId].apiBase,
                    apiKey: legacyKey || profiles[activeId].apiKey,
                    model: legacyModel || profiles[activeId].model
                };
            }
        }
        return { activeId: activeId, profiles: profiles, customs: customs };
    }
    function resolve(profiles, id, customs) {
        const s0 = str(id);
        const p = byId(s0, customs) ||
            (s0 && profiles && profiles[s0]
                ? { id: s0, label: s0, note: '', custom: true, apiBase: '', model: '' }
                : null) ||
            byId(DEFAULT_ID);
        const cur = (profiles && profiles[p.id]) || {};
        return {
            id: p.id,
            label: p.label,
            note: p.note || '',
            custom: !!p.custom,
            apiBase: str(cur.apiBase) || p.apiBase || '',
            apiKey: str(cur.apiKey),
            model: str(cur.model) || p.model || ''
        };
    }
    function flatten(profiles, id, customs) {
        const r = resolve(profiles, id, customs);
        return { apiBase: r.apiBase, apiKey: r.apiKey, model: r.model };
    }
    function options(customs) {
        const out = PRESETS.filter(function (p) { return !p.hidden; }).map(function (p) {
            return { value: p.id, model: p.model, label: p.note ? p.label + ' · ' + p.note : p.label, custom: !!p.custom };
        });
        for (const c of customs || []) {
            if (c && c.id)
                out.push({ value: c.id, model: c.model || c.label || c.id, label: c.label || c.id, custom: true });
        }
        out.push({ value: ADD_ID, label: '＋ 新增模型', add: true });
        return out;
    }
    global.EraModels = {
        CUSTOM_ID: CUSTOM_ID,
        ADD_ID: ADD_ID,
        DEFAULT_ID: DEFAULT_ID,
        PRESETS: PRESETS,
        byId: byId,
        isCustom: isCustom,
        defaultProfile: defaultProfile,
        emptyProfiles: emptyProfiles,
        matchPresetByBase: matchPresetByBase,
        matchPresetByModel: matchPresetByModel,
        normalize: normalize,
        resolve: resolve,
        flatten: flatten,
        options: options
    };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
