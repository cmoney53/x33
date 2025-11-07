async function main() {
  // === 🧠 CONFIGURATION ===
  const username = "cmoney53";   // 👈 your GitHub username
  const repo = "x33";            // 👈 your repository name
  const branch = "main";         // GitHub branch (usually main)
  const folder = "userscripts";  // Folder containing scripts

  // === ⚙️ BASIC SETUP ===
  const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${folder}?ref=${branch}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    document.body.innerHTML = `<h2>❌ Failed to load userscripts from GitHub API.</h2>
    <p>Make sure your repo is public and that <code>${folder}/</code> exists.</p>`;
    return;
  }
  const files = await response.json();
  const jsFiles = files.filter(f => f.name.endsWith(".js"));

  const container = document.getElementById("scripts");
  const search = document.getElementById("search");
  const consoleBox = document.getElementById("console");

  function log(msg) {
    consoleBox.textContent += msg + "\n";
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  // === 🧩 GM_xmlhttpRequest EMULATOR ===
  const GM_xmlhttpRequest = (details) => {
    fetch(details.url)
      .then(r => r.text())
      .then(t => details.onload && details.onload({ responseText: t }))
      .catch(e => details.onerror && details.onerror(e));
  };

  log(`📦 Found ${jsFiles.length} scripts... loading metadata`);

  let scriptsMeta = [];

  // === 📥 LOAD METADATA FROM EACH SCRIPT ===
  let i = 0;
  for (const file of jsFiles) {
    i++;
    log(`🔍 Reading ${file.name} (${i}/${jsFiles.length})`);

    try {
      const rawUrl = file.download_url;
      const src = await fetch(rawUrl).then(r => r.text());
      const name = (src.match(/@name\s+(.*)/) || [])[1] || file.name;
      const desc = (src.match(/@description\s+(.*)/) || [])[1] || "";
      const match = (src.match(/@match\s+(.*)/) || [])[1] || "*://*.drednot.io/*";
      const matchOk = matchUrl(match, window.location.href);

      scriptsMeta.push({ file, name, desc, match, matchOk, src });
    } catch (err) {
      log(`⚠️ Error reading ${file.name}: ${err.message}`);
    }
  }

  // === 🖼️ RENDER UI ===
  render(scriptsMeta);

  function render(data) {
    container.innerHTML = "";
    const filter = search.value.toLowerCase();

    for (const s of data) {
      if (!s.name.toLowerCase().includes(filter)) continue;

      const enabled = localStorage.getItem("script_" + s.file.name) === "on";
      const div = document.createElement("div");
      div.className = "script-card";

      const info = document.createElement("div");
      const tag = s.matchOk
        ? `<span style="color:#22d3ee;">✅ Match</span>`
        : `<span style="color:#888;">🚫 No Match</span>`;
      info.innerHTML = `<strong>${s.name}</strong> ${tag}<br>${s.desc}<br><small>${s.match}</small>`;

      const btn = document.createElement("button");
      btn.textContent = enabled ? "ON" : "OFF";
      if (!enabled) btn.classList.add("off");
      if (!s.matchOk) btn.disabled = true;

      btn.onclick = () => {
        const en = localStorage.getItem("script_" + s.file.name) === "on";
        if (en) {
          localStorage.setItem("script_" + s.file.name, "off");
          btn.textContent = "OFF";
          btn.classList.add("off");
          log(`🔴 Disabled ${s.name}`);
        } else {
          localStorage.setItem("script_" + s.file.name, "on");
          btn.textContent = "ON";
          btn.classList.remove("off");
          runScript(s);
          log(`🟢 Enabled ${s.name}`);
        }
      };

      div.append(info, btn);
      container.appendChild(div);

      // Auto-run if enabled and matches URL
      if (enabled && s.matchOk) runScript(s);
    }
  }

  search.oninput = () => render(scriptsMeta);

  // === 🔍 URL PATTERN MATCHER ===
  function matchUrl(pattern, url) {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\//g, "\\/") + "$"
    );
    return regex.test(url);
  }

  // === 🚀 SCRIPT RUNNER ===
  function runScript(s) {
    try {
      const fn = new Function("GM_xmlhttpRequest", s.src);
      fn(GM_xmlhttpRequest);
      log(`✅ ${s.name} executed successfully.`);
    } catch (e) {
      log(`❌ Error in ${s.name}: ${e.message}`);
    }
  }

  log(`✅ All scripts loaded. Use ON/OFF to activate.`);
}

// === RUN APP ===
main();
