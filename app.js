const availableScripts = [
  { name: "PvP Tracker", file: "pvp-tracker.js" },
  { name: "Ship Builder", file: "ship-builder.js" },
  { name: "Faction Leaderboard", file: "faction-leaderboard.js" }
];

function log(msg) {
  document.getElementById("console").textContent += msg + "\n";
}

function GM_xmlhttpRequest(details) {
  fetch(details.url)
    .then(r => r.text())
    .then(t => details.onload && details.onload({ responseText: t }))
    .catch(e => details.onerror && details.onerror(e));
}

function loadScriptsUI() {
  const container = document.getElementById("scripts");
  container.innerHTML = "";

  availableScripts.forEach(script => {
    const enabled = localStorage.getItem("script_" + script.file) === "on";
    const div = document.createElement("div");
    div.className = "script-card";

    const label = document.createElement("span");
    label.textContent = script.name;

    const btn = document.createElement("button");
    btn.textContent = enabled ? "ON" : "OFF";
    if (!enabled) btn.classList.add("off");

    btn.onclick = () => toggleScript(script, btn);

    div.append(label, btn);
    container.appendChild(div);

    if (enabled) runScript(script);
  });
}

function toggleScript(script, button) {
  const enabled = localStorage.getItem("script_" + script.file) === "on";
  if (enabled) {
    localStorage.setItem("script_" + script.file, "off");
    button.textContent = "OFF";
    button.classList.add("off");
    log(`🔴 Disabled ${script.name}`);
  } else {
    localStorage.setItem("script_" + script.file, "on");
    button.textContent = "ON";
    button.classList.remove("off");
    log(`🟢 Enabled ${script.name}`);
    runScript(script);
  }
}

function runScript(script) {
  log(`Loading ${script.name}...`);
  const s = document.createElement("script");
  s.src = "userscripts/" + script.file;
  s.onload = () => log(`✅ ${script.name} loaded.`);
  s.onerror = () => log(`❌ Failed to load ${script.name}`);
  document.body.appendChild(s);
}

loadScriptsUI();
