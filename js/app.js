/* Black Market Advisor ordered module loader. */
(() => {
  'use strict';
  const modules = ['core.js','memory.js','parser.js','assumptions.js','events.js','portfolio.js','advisor.js','ui.js','qa.js','bootstrap.js'];
  const currentScript = document.currentScript;
  const baseUrl = currentScript?.src ? new URL('.', currentScript.src) : new URL('js/', window.location.href);
  const load = file => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`${file}?v=8`, baseUrl).href;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${file}`));
    document.head.appendChild(script);
  });
  modules.reduce((chain, file) => chain.then(() => load(file)), Promise.resolve()).catch(error => {
    console.error('Black Market Advisor failed to start:', error);
    const status = document.getElementById('parseStatus');
    if (status) status.textContent = `Advisor failed to start: ${error.message}`;
  });
})();
