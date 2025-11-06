/* Iframe-only userscripts manager
   - stores scripts in localStorage under 'ius_scripts'
   - injects by eval for same-origin (try/catch)
   - falls back to postMessage with {type:'ius-run', code} (requires page to listen)
*/

const frame = document.getElementById('targetFrame');
const urlInput = document.getElementById('url');
const loadBtn = document.getElementById('loadBtn');
const openBtn = document.getElementById('openBtn');
const injectOnLoad = document.getElementById('injectOnLoad');

const menuToggle = document.getElementById('menuToggle');
const menuContent = document.getElementById('menuContent');
const scriptsList = document.getElementById('scriptsList');
const addScriptBtn = document.getElementById('addScriptBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const scriptName = document.getElementById('scriptName');
const scriptCode = document.getElementById('scriptCode');
const saveScript = document.getElementById('saveScript');
const cancelScript = document.getElementById('cancelScript');
const tpl = document.getElementById('scriptRowTpl');

let scripts = []; // {id, name, code, enabled}
let editingId = null;

function persist(){ localStorage.setItem('ius_scripts', JSON.stringify(scripts)); }
function loadScripts(){
  const raw = localStorage.getItem('ius_scripts');
  if(raw) scripts = JSON.parse(raw);
  else {
    // add a demo script
    scripts = [{
      id: Date.now(),
      name: 'Hello banner',
      code: `(() => {
  const el = document.createElement('div');
  el.id = 'ius-demo-banner';
  el.style = 'position:fixed;left:8px;top:8px;background:gold;padding:6px;z-index:2147483647';
  el.textContent = 'Hello from userscript!';
  document.documentElement.appendChild(el);
})();`,
      enabled: true
    }];
    persist();
  }
}

function render(){
  scriptsList.innerHTML = '';
  scripts.forEach(s => {
    const node = tpl.content.cloneNode(true);
    const row = node.querySelector('.script-row');
    const cb = row.querySelector('.script-enable');
    const nameEl = row.querySelector('.script-name');
    const runNow = row.querySelector('.run-now');
    const editBtn = row.querySelector('.edit-script');
    const removeBtn = row.querySelector('.remove-script');

    cb.checked = !!s.enabled;
    cb.onchange = () => { s.enabled = cb.checked; persist(); render(); };
    nameEl.textContent = s.name;
    runNow.onclick = () => runScript(s);
    editBtn.onclick = () => openEditor(s.id);
    removeBtn.onclick = () => {
      if(!confirm('Remove script "'+s.name+'"?')) return;
      scripts = scripts.filter(x => x.id !== s.id);
      persist(); render();
    };

    scriptsList.appendChild(node);
  });
}

function openEditor(id){
  editingId = id || null;
  if(id){
    const s = scripts.find(x=>x.id===id);
    modalTitle.textContent = 'Edit script';
    scriptName.value = s.name;
    scriptCode.value = s.code;
  } else {
    modalTitle.textContent = 'New script';
    scriptName.value = '';
    scriptCode.value = '// your JS here';
  }
  modal.classList.remove('hidden');
}

saveScript.onclick = () => {
  const name = scriptName.value.trim() || 'untitled';
  const code = scriptCode.value || '';
  if(editingId){
    const s = scripts.find(x=>x.id===editingId);
    s.name = name; s.code = code;
  } else {
    scripts.push({id: Date.now(), name, code, enabled:true});
  }
  persist();
  render();
  modal.classList.add('hidden');
};
cancelScript.onclick = () => modal.classList.add('hidden');

addScriptBtn.onclick = () => openEditor(null);
exportBtn.onclick = () => {
  const data = JSON.stringify(scripts, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'userscripts.json'; a.click();
  URL.revokeObjectURL(url);
};
importBtn.onclick = async () => {
  const input = document.createElement('input'); input.type='file'; input.accept='.json,application/json';
  input.onchange = async (e) => {
    const f = e.target.files[0]; if(!f) return;
    const txt = await f.text();
    try {
      const imported = JSON.parse(txt);
      if(Array.isArray(imported)) {
        // simple merge: add with new ids
        imported.forEach(s => {
          scripts.push({id: Date.now()+Math.random(), name: s.name || 'imp', code: s.code||'//', enabled: !!s.enabled});
        });
        persist(); render();
        alert('Imported ' + imported.length + ' scripts');
      } else alert('Invalid file format');
    } catch(err){
      alert('Import failed: ' + err);
    }
  };
  input.click();
};

menuToggle.onclick = () => {
  menuContent.hidden = !menuContent.hidden;
};

loadBtn.onclick = () => {
  let u = urlInput.value.trim();
  if(!u) return alert('Enter a URL');
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  frame.src = u;
};

openBtn.onclick = () => {
  let u = urlInput.value.trim();
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  // open in new tab (no proxy) — useful if iframe blocked and user wants site directly
  window.open(u, '_blank');
};

frame.addEventListener('load', () => {
  // optionally inject enabled scripts
  if(injectOnLoad.checked) {
    injectEnabledScripts();
  }
});

/* injection strategies:
   1) Try same-origin eval: frame.contentWindow.eval(code)
   2) If cross-origin, we cannot access contentWindow.eval; try postMessage:
      postMessage({type:'ius-run', code}, '*')
   Note: Most cross-origin pages will not have a listener to run posted code, so postMessage usually fails silently.
*/
function runScript(script){
  const code = script.code;
  // try same-origin eval
  try {
    frame.contentWindow && frame.contentWindow.eval && frame.contentWindow.eval(code);
    console.log('Injected via eval into iframe (same-origin).');
    showToast('Injected: ' + script.name);
    return;
  } catch(e){
    console.warn('Direct eval failed (likely cross-origin):', e);
  }
  // fallback: postMessage
  try {
    frame.contentWindow.postMessage({type:'ius-run', id: script.id, code}, '*');
    console.log('Posted message to iframe; waiting for page-level listener (if any).');
    showToast('Posted message to iframe (listener required).');
  } catch(e){
    console.error('postMessage failed:', e);
    alert('Injection failed: cross-origin restrictions.');
  }
}

function injectEnabledScripts(){
  const enabled = scripts.filter(s=>s.enabled);
  enabled.forEach(s => {
    try { runScript(s); } catch(err){ console.error('inject error', err); }
  });
}

/* show small ephemeral toast */
function showToast(text){
  const t = document.createElement('div');
  t.textContent = text;
  Object.assign(t.style, {position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'24px',background:'#111',color:'#fff',padding:'8px 12px',borderRadius:'8px',zIndex:999999});
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}

/* Listen for ack/errors from iframe runtime if the page implements a bridge */
window.addEventListener('message', e => {
  const d = e.data || {};
  if(d && d.type === 'ius-ack') {
    showToast('Script executed: ' + (d.id || 'anon'));
  }
  if(d && d.type === 'ius-error') {
    console.error('Script error', d);
    alert('Script error: ' + (d.error||'unknown'));
  }
});

// init
loadScripts();
render();
