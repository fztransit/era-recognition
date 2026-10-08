(function (global) {
    'use strict';
    const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
    function areaOf(name) {
        if (!chromeApi || !chromeApi.storage || !chromeApi.storage[name]) {
            throw new Error('当前环境不支持 chrome.storage.' + name);
        }
        return chromeApi.storage[name];
    }
    function lastError() {
        try {
            return chromeApi && chromeApi.runtime && chromeApi.runtime.lastError;
        }
        catch (e) {
            return null;
        }
    }
    function invoke(areaName, method, args) {
        return new Promise(function (resolve, reject) {
            let settled = false;
            const finish = function (fn, value) {
                if (settled)
                    return;
                settled = true;
                fn(value);
            };
            try {
                const area = areaOf(areaName);
                area[method].apply(area, (args || []).concat(function (result) {
                    const err = lastError();
                    if (err) {
                        finish(reject, new Error(err.message || 'storage 操作失败'));
                        return;
                    }
                    finish(resolve, result);
                }));
            }
            catch (e) {
                finish(reject, e);
            }
        });
    }
    function get(areaName, keys) {
        return invoke(areaName, 'get', [keys]).then(function (value) {
            return value && typeof value === 'object' ? value : {};
        });
    }
    function getAll(areaName) {
        return get(areaName, null);
    }
    function getValue(areaName, key, fallback) {
        return get(areaName, { [key]: fallback }).then(function (value) {
            return value[key] === undefined ? fallback : value[key];
        });
    }
    function set(areaName, values) {
        if (!values || typeof values !== 'object') {
            return Promise.reject(new TypeError('storage.set 需要对象参数'));
        }
        return invoke(areaName, 'set', [values]).then(function () { return true; });
    }
    function remove(areaName, keys) {
        return invoke(areaName, 'remove', [keys]).then(function () { return true; });
    }
    function createArea(areaName) {
        return Object.freeze({
            get: function (keys) { return get(areaName, keys); },
            getAll: function () { return getAll(areaName); },
            getValue: function (key, fallback) { return getValue(areaName, key, fallback); },
            set: function (values) { return set(areaName, values); },
            remove: function (keys) { return remove(areaName, keys); }
        });
    }
    global.EraStorage = Object.freeze({
        local: createArea('local'),
        sync: createArea('sync'),
        available: function (name) {
            try {
                return !!areaOf(name || 'local');
            }
            catch (e) {
                return false;
            }
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);
