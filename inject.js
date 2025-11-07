// == Drednot Userscript Loader (inject.js) ==
// Paste this file onto your GitHub Pages (e.g. https://<you>.github.io/x33/inject.js)
// Then use the bookmarklet (provided below) to inject it into drednot.io pages.
//
// It will:
// - create a floating UI
// - fetch all .js scripts from your GitHub repo userscripts folder
// - parse @name / @match / @description
// - allow ON/OFF per script (persisted to localStorage)
// - provide a GM_xmlhttpRequest shim using fetch()
// - execute scripts directly in page context

(async function(){
  if (window.__dred_loader_loaded) { console.info('Dred Loader already loaded'); return; }
  window.__dred_loader_loaded = true;

  // ------------- CONFIG -------------
  const GITHUB_USER = "cmoney53";   // <- change to your username
  const GITHUB_REPO = "x33";        // <- change to your repo name
  const GITHUB_BRANCH = "main";     // <- branch where userscripts/ lives
  const SCRIPTS_FOLDER = "userscripts";
  // ----------------------------------

  // Simple CSS for the floating UI
  const css = `
  #dred-loader { position: fixed; right: 12px; top: 60px; width: 360px; z-index: 2147483647;
                 font-family: Inter, system-ui, Arial; background:#0f1720;color:#e5e7eb;border-radius:10px;
                 box-shadow:0 10px 40px rgba(0,0,0,.6); padding:10px; border:1px solid rgba(255,255,255,.04); }
  #dred-loader h3{margin:0 0 8px 0;font-size:14px;color:#60a5fa}
  #dred-loader .list{max-height:360px;overflow:auto;padding-right:6px}
  #dred-loader .script-row{display:flex;align-items:center;justify-content:space-between;padding:8px;background:#0b1220;border-radius:6px;margin-bottom:6px}
  #dred-loader button{background:#22d3ee;border:0;padding:6px 8px;border-radius:6px;cursor:pointer}
  #dred-loader button.off{background:#334155;color:#9ca3af}
  #dred-loader .small{font-size:12px;color:#94a3b8}
  #dred-loader .search{width:100%;padding:8px;margin-bottom:8px;border-radius:6px;border:1px solid rgba(255,255,255,.04);background:#071126;color:#fff}
  #dred-loader .close{position:absolute;left:8px;top:8px;background:transparent;border:0;color:#94a3b8;cursor:pointer}
  #dred-loader .footer{font-size:12px;color:#94a3b8;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
  `;

  // inject style
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // GM shim
  window.GM_xmlhttpRequest = window.GM_xmlhttpRequest || function(details){
    // details: { method, url, headers, data, onload, onerror }
    fetch(details.url, { method: details.method || 'GET', headers: details.headers || {}, body: details.data || undefined, credentials: 'include' })
      .then(r => r.text().then(txt => { details.onload && details.onload({ responseText: txt, status: r.status }); }))
      .catch(err => { details.onerror && details.onerror(err); });
  };
  window.GM_addStyle = window.GM_addStyle || function(cssText){ const s=document.createElement('style'); s.textContent=cssText; document.head.appendChild(s); };

  // UI container
  const container = document.createElement('div');
  container.id = 'dred-loader';
  container.innerHTML = `
    <button class="close" title="Close loader">✕</button>
    <h3>Drednot Userscript Hub</h3>
    <input class="search" placeholder="Search scripts..." />
    <div class="list">Loading scripts...</div>
    <div class="footer">
      <span class="small">Scripts from ${GITHUB_USER}/${GITHUB_REPO}/${SCRIPTS_FOLDER}</span>
      <button id="refresh-scripts">Refresh</button>
    </div>
  `;
  document.body.appendChild(container);

  const listEl = container.querySelector('.list');
  const searchEl = container.querySelector('.search');
  const refreshBtn = container.querySelector('#refresh-scripts');
  container.querySelector('.close').onclick = ()=>container.remove();

  // helper logger in UI
  function logUI(txt){
    // append small log at top of list
    const el = document.createElement('div');
    el.className = 'small';
    el.style.padding = '6px';
    el.style.opacity = '0.85';
    el.textContent = txt;
    listEl.prepend(el);
    setTimeout(()=>{ el.remove(); }, 5000);
  }

  // fetch list of .js in userscripts/ via GitHub API (no auth, public repo)
  async function fetchScriptFiles(){
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${SCRIPTS_FOLDER}?ref=${GITHUB_BRANCH}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const arr = await res.json();
    return arr.filter(f => f.name && f.name.endsWith('.js'));
  }

  // fetch raw content for a file object from GitHub (download_url field)
  async function fetchRawScript(fileObj){
    if (!fileObj || !fileObj.download_url) throw new Error('Bad file object');
    const res = await fetch(fileObj.download_url);
    if (!res.ok) throw new Error('Failed to fetch script ' + fileObj.name);
    return await res.text();
  }

  // parse header metadata
  function parseHeader(src){
    const header = { name: null, description: null, match: [] };
    const headerMatch = src.match(/==UserScript==([\\s\\S]*?)==\\/UserScript==/i);
    const block = headerMatch ? headerMatch[1] : src.slice(0, 1000);
    const lines = block.split(/\\r?\\n/);
    for (let l of lines){
      l = l.trim();
      const mname = l.match(/@name\\s+(.*)/i);
      if (mname) header.name = (mname[1]||'').trim();
      const mdesc = l.match(/@description\\s+(.*)/i);
      if (mdesc) header.description = (mdesc[1]||'').trim();
      const mmatch = l.match(/@match\\s+(.*)/i);
      if (mmatch) header.match.push((mmatch[1]||'').trim());
    }
    return header;
  }

  function patternToRegex(p){
    // simple conversion * -> .* and escape slashes
    const r = '^' + p.replace(/[-/\\\\^$+?.()|[\]{}]/g, '\\\\$&').replace(/\\\\\\*/g, '.*').replace(/\\*/g, '.*') + '$';
    try { return new RegExp(r); } catch(e) { return new RegExp('^.*$'); }
  }

  // load scripts metadata and build UI items
  let scriptsMeta = []; // { fileObj, name, desc, matchArr, src }
  async function loadAllScripts(){
    listEl.innerHTML = 'Scanning scripts...';
    scriptsMeta = [];
    try {
      const fileObjs = await fetchScriptFiles();
      if (!fileObjs.length) { listEl.innerHTML = '<div class="small">No scripts found in userscripts/</div>'; return; }
      // progress
      let idx = 0;
      for (const f of fileObjs){
        idx++;
        listEl.innerHTML = `<div class="small">Loading ${idx}/${fileObjs.length}: ${f.name}</div>`;
        try {
          const src = await fetchRawScript(f);
          const hdr = parseHeader(src);
          scriptsMeta.push({ fileObj: f, name: hdr.name||f.name, desc: hdr.description||'', matchArr: hdr.match.length?hdr.match:['*://*.drednot.io/*'], src });
        } catch(err){
          console.warn('failed load', f.name, err);
        }
      }
      renderList();
      logUI(`Loaded ${scriptsMeta.length} scripts`);
    } catch(err) {
      listEl.innerHTML = `<div class="small">Error loading scripts: ${err.message}</div>`;
    }
  }

  function renderList(){
    const q = (searchEl.value||'').toLowerCase().trim();
    listEl.innerHTML = '';
    for (const s of scriptsMeta){
      if (q && !(s.name||'').toLowerCase().includes(q) && !(s.fileObj.name||'').toLowerCase().includes(q) && !(s.desc||'').toLowerCase().includes(q)) continue;
      const row = document.createElement('div');
      row.className = 'script-row';
      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:600">${s.name}</div><div class="small">${s.desc}</div><div class="small">${s.fileObj.name}</div>`;
      const right = document.createElement('div');
      const enabledKey = 'dred_script_' + s.fileObj.name;
      const isOn = localStorage.getItem(enabledKey) === 'on';
      // check match against current location
      const matches = s.matchArr.some(p => patternToRegex(p).test(location.href));
      const btn = document.createElement('button');
      btn.textContent = isOn ? 'ON' : 'OFF';
      if (!isOn) btn.classList.add('off');
      if (!matches) { btn.disabled = false; /* allow manual forcing too */ }
      btn.onclick = async ()=>{
        const nowOn = localStorage.getItem(enabledKey) === 'on';
        if (nowOn) {
          localStorage.setItem(enabledKey, 'off');
          btn.textContent = 'OFF'; btn.classList.add('off');
          logUI('Disabled ' + s.name);
          // no reliable way to undo executed script; recommend reload
        } else {
          localStorage.setItem(enabledKey, 'on');
          btn.textContent = 'ON'; btn.classList.remove('off');
          logUI('Enabled ' + s.name + ' — executing now');
          executeScript(s);
        }
      };
      right.appendChild(btn);
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);

      // auto-run if enabled and matches
      if (isOn && s.matchArr.some(p => patternToRegex(p).test(location.href))) {
        executeScript(s);
      }
    }
    if (!listEl.innerHTML) listEl.innerHTML = '<div class="small">No scripts match your query.</div>';
  }

  searchEl.addEventListener('input', ()=>renderList());
  refreshBtn.addEventListener('click', ()=>loadAllScripts());

  // execute script in page context by injecting <script> with text
  function executeScript(s){
    try {
      const wrapper = `;(function(){ try{ ${s.src}\n }catch(e){ console.error('Userscript error: ', e); } })();`;
      const el = document.createElement('script');
      el.type = 'text/javascript';
      el.textContent = wrapper;
      document.documentElement.appendChild(el);
      // remove after executed to avoid clutter
      setTimeout(()=>el.remove(), 2000);
    } catch (e) {
      console.error('executeScript failed', e);
    }
  }

  // initial load
  await loadAllScripts();

  // small keyboard shortcut: Ctrl+Shift+L toggles visibility
  let visible = true;
  function setVisible(v){ container.style.display = v ? 'block' : 'none'; visible = v; }
  document.addEventListener('keydown', (e)=>{
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { setVisible(!visible); }
  });

  // done
  console.info('Drednot Userscript Hub injected');
})();
