(function () {
    'use strict';
    // 这里只负责挂载设置面板。
    function init() {
        window.EraSettings.mount(document.getElementById('op-settings-mount'), {
            onChange: function () {
            }
        });
    }
    document.addEventListener('DOMContentLoaded', init);
})();
