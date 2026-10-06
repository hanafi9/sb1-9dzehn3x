"use strict";

// ------------------------------------------------------------ outils
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (_) { /* réponse vide */ }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

async function withButton(btn, fn) {
  btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}

// ------------------------------------------------------------ onglets
const loaders = {};
let currentTab = "dashboard";
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
});
function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  if (loaders[name]) loaders[name]();
}

// ------------------------------------------------------------ tableau de bord
function servicePill(state) {
  if (state === "active") return pill(true, "actif", "");
  if (state === "inconnu") return pill(null, "", "", "inconnu");
  return pill(false, "", state);
}
function pill(ok, yes, no, unknown = "inconnu") {
  if (ok === null || ok === undefined) return `<span class="pill warn">${esc(unknown)}</span>`;
  return ok ? `<span class="pill ok">${esc(yes)}</span>` : `<span class="pill bad">${esc(no)}</span>`;
}

loaders.dashboard = async () => {
  try {
    const s = await api("GET", "/api/status");
    const mrl = $("#mrl-pill");
    mrl.className = "pill " + (s.mrl.ok ? "ok" : "bad");
    mrl.textContent = s.mrl.ok ? "MyRobotLab connecté" : "MyRobotLab injoignable";
    const services = Object.entries(s.services).map(([n, v]) =>
      `<div class="row between"><span>${esc(v.label)}</span>${servicePill(v.state)}</div>`).join("");
    $("#dash-cards").innerHTML = `
      <div class="card"><h2>MyRobotLab</h2>
        <div class="row between"><span>${esc(s.mrl.url)}</span>${pill(s.mrl.ok, "connecté", "injoignable")}</div>
        ${s.mrl.ok ? `<p class="muted">Version ${esc(s.mrl.version)} · en marche depuis ${esc(s.mrl.uptime)}</p>` :
          `<p class="muted">Démarrez MyRobotLab (myrobotlab.sh) puis InMoov2.</p>`}
      </div>
      <div class="card"><h2>Matériel</h2>
        <div class="row between"><span>Coral USB</span>${pill(s.coral, "détecté", "absent")}</div>
        <div class="row between"><span>Ports série</span><span>${s.serial_ports.length ? esc(s.serial_ports.join(", ")) : "aucun"}</span></div>
        <div class="row between"><span>Jambes</span>${pill(s.legs_connected, "connectées", "non connectées")}</div>
      </div>
      <div class="card"><h2>Services</h2>${services}</div>`;
  } catch (e) { toast(e.message, true); }
  const g = await api("GET", "/api/guide");
  const steps = g.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.phase })));
  const done = steps.filter((s) => g.done[s.id]).length;
  $("#dash-progress-bar").style.width = (100 * done / steps.length) + "%";
  $("#dash-progress-text").textContent = `${done} étape(s) sur ${steps.length}`;
  const next = steps.find((s) => !g.done[s.id]);
  $("#dash-next").innerHTML = next ? `Prochaine étape : <b>${esc(next.phase)} — ${esc(next.title)}</b>` : "Bravo, tout est terminé !";
};

// ------------------------------------------------------------ guide
loaders.guide = async () => {
  const g = await api("GET", "/api/guide");
  const all = g.phases.flatMap((p) => p.steps);
  const doneCount = all.filter((s) => g.done[s.id]).length;
  $("#guide-progress-bar").style.width = (100 * doneCount / all.length) + "%";
  $("#guide-phases").innerHTML = g.phases.map((p) => {
    const n = p.steps.filter((s) => g.done[s.id]).length;
    return `<div class="card"><div class="row between"><h2>${esc(p.phase)}</h2><span class="pill ${n === p.steps.length ? "ok" : ""}">${n}/${p.steps.length}</span></div>
      ${p.steps.map((s) => `
        <div class="step ${g.done[s.id] ? "done" : ""}">
          <label><input type="checkbox" data-step="${esc(s.id)}" ${g.done[s.id] ? "checked" : ""}>
            <div><h3>${esc(s.title)}</h3>${s.details ? `<p class="muted">${esc(s.details)}</p>` : ""}</div></label>
          ${(s.commands || []).map((c) => `<div class="cmd"><code>${esc(c)}</code><button class="ghost" data-copy="${esc(c)}">Copier</button></div>`).join("")}
        </div>`).join("")}
    </div>`;
  }).join("");
};
$("#guide-phases").addEventListener("change", async (e) => {
  const id = e.target.dataset.step;
  if (!id) return;
  try { await api("POST", `/api/guide/${encodeURIComponent(id)}`, { done: e.target.checked }); loaders.guide(); }
  catch (err) { toast(err.message, true); }
});
$("#guide-phases").addEventListener("click", async (e) => {
  const text = e.target.dataset.copy;
  if (text === undefined) return;
  try { await navigator.clipboard.writeText(text); toast("Commande copiée"); }
  catch (_) { toast("Copie impossible : sélectionnez le texte à la main", true); }
});

// ------------------------------------------------------------ servos
let servoGroups = [];
loaders.servos = async () => {
  const data = await api("GET", "/api/servos");
  servoGroups = data.groups;
  const sel = $("#servo-group");
  const prev = sel.value;
  sel.innerHTML = servoGroups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join("");
  if (prev) sel.value = prev;
  renderServos();
};
$("#servo-group").addEventListener("change", renderServos);

function renderServos() {
  const g = servoGroups.find((x) => x.key === $("#servo-group").value) || servoGroups[0];
  if (!g) return;
  $("#servo-list").innerHTML = g.servos.map((s) => `
    <div class="card servo" data-service="${esc(s.service)}">
      <div class="row between"><h3>${esc(s.label)}</h3><span class="pos">${s.rest}</span></div>
      <div class="meta">${esc(s.service)} · broche ${esc(s.pin)} · carte ${esc(s.board)}</div>
      <input type="range" min="0" max="180" step="1" value="${s.rest}" aria-label="position">
      <div class="row wrap">
        <button class="ghost" data-act="rest">Repos</button>
        <button class="ghost" data-act="enable">Activer</button>
        <button class="ghost" data-act="disable">Désactiver</button>
        <button class="ghost" data-act="read">Lire</button>
      </div>
      <div class="fields">
        <label>min (sortie) <input type="number" name="min_out" min="0" max="180" value="${s.min_out}"></label>
        <label>max (sortie) <input type="number" name="max_out" min="0" max="180" value="${s.max_out}"></label>
        <label>repos <input type="number" name="rest" min="0" max="180" value="${s.rest}"></label>
        <label>vitesse °/s <input type="number" name="speed" min="0" max="1000" value="${s.speed ?? ""}"></label>
      </div>
      <label class="check"><input type="checkbox" name="inverted" ${s.inverted ? "checked" : ""}> inversé</label>
      <div class="row wrap">
        <button data-act="save">Enregistrer</button>
        <button data-act="save-apply">Enregistrer + appliquer</button>
      </div>
    </div>`).join("");
}

// Le curseur envoie au plus une commande toutes les 150 ms (et la dernière valeur au relâchement).
const sliderTimers = new Map();
$("#servo-list").addEventListener("input", (e) => {
  if (e.target.type !== "range") return;
  const card = e.target.closest(".servo");
  const service = card.dataset.service;
  $(".pos", card).textContent = e.target.value;
  if (sliderTimers.has(service)) return;
  sliderTimers.set(service, setTimeout(() => sliderTimers.delete(service), 150));
  sendMove(service, e.target.value);
});
$("#servo-list").addEventListener("change", (e) => {
  if (e.target.type !== "range") return;
  sendMove(e.target.closest(".servo").dataset.service, e.target.value);
});
function sendMove(service, pos) {
  api("POST", `/api/servos/${encodeURIComponent(service)}/move`, { pos: Number(pos) }).catch((err) => toast(err.message, true));
}

$("#servo-list").addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  const card = e.target.closest(".servo");
  const service = encodeURIComponent(card.dataset.service);
  withButton(e.target, async () => {
    if (act === "read") {
      const r = await api("GET", `/api/servos/${service}/position`);
      const pos = Math.round(r.pos);
      $(".pos", card).textContent = pos;
      $("input[type=range]", card).value = pos;
    } else if (act === "save" || act === "save-apply") {
      const v = (n) => $(`[name=${n}]`, card).value;
      await api("PUT", `/api/servos/${service}/calibration`, {
        min_out: v("min_out"), max_out: v("max_out"), rest: v("rest"), speed: v("speed"),
        inverted: $("[name=inverted]", card).checked, apply: act === "save-apply",
      });
      toast(act === "save" ? "Calibration enregistrée" : "Calibration enregistrée et appliquée");
      const data = await api("GET", "/api/servos");
      servoGroups = data.groups;
    } else {
      await api("POST", `/api/servos/${service}/action`, { action: act });
      toast({ rest: "Au repos", enable: "Activé", disable: "Désactivé" }[act]);
    }
  });
});

$("#servo-apply-all").addEventListener("click", (e) => withButton(e.target, async () => {
  const r = await api("POST", "/api/servos/apply_all");
  toast(r.errors && r.errors.length ? r.errors[0] : "Toutes les calibrations ont été appliquées", !!(r.errors && r.errors.length));
}));
$("#mrl-save-config").addEventListener("click", (e) => withButton(e.target, async () => {
  await api("POST", "/api/mrl/save_config", { name: $("#mrl-config-name").value });
  toast("Configuration MyRobotLab enregistrée");
}));
$("#servo-defaults").addEventListener("click", (e) => withButton(e.target, async () => {
  if (!confirm("Remettre toutes les calibrations aux valeurs par défaut d'InMoov2 ?")) return;
  await api("POST", "/api/servos/reset_defaults");
  await loaders.servos();
  toast("Valeurs par défaut restaurées (pas encore appliquées)");
}));

// ------------------------------------------------------------ arduino
loaders.arduino = async () => {
  const data = await api("GET", "/api/arduino/sketches");
  $("#ard-libs").textContent = data.libraries.join(", ");
  $("#ard-sketches").innerHTML = data.sketches.map((s) => `
    <div class="card" data-sketch="${esc(s.id)}">
      <div class="row between"><h2>${esc(s.title)}</h2>${pill(s.exists, "trouvé", "introuvable")}</div>
      <p>${esc(s.description)}</p>
      <p class="muted">${esc(s.path)}</p>
      <p class="muted">⚠ ${esc(s.before)}</p>
      <div class="row wrap">${s.files.map((f) => `<button class="ghost" data-file="${esc(f)}">${esc(f)}</button>`).join("")}</div>
      <div class="row wrap">
        <select class="port"><option value="">— port —</option></select>
        <button data-build="compile" ${s.exists ? "" : "disabled"}>Compiler</button>
        <button data-build="upload" ${s.exists ? "" : "disabled"}>Téléverser</button>
      </div>
    </div>`).join("");
  loadBoards();
};

async function loadBoards() {
  const r = await api("GET", "/api/arduino/boards").catch((e) => ({ ok: false, error: e.message, boards: [], by_id: [] }));
  const rows = r.boards.map((b) => `<tr><td>${esc(b.port)}</td><td>${esc(b.name)}</td><td>${esc(b.fqbn || "")}</td></tr>`).join("");
  const byId = (r.by_id || []).map((b) => `<tr><td colspan="3" class="muted">${esc(b.path)} → ${esc(b.target)}</td></tr>`).join("");
  $("#ard-boards").innerHTML = r.ok
    ? (rows ? `<table><tr><th>Port</th><th>Carte</th><th>FQBN</th></tr>${rows}${byId}</table>` : `<p class="muted">Aucune carte détectée.</p>`)
    : `<p class="muted">${esc(r.error)}</p>`;
  const options = `<option value="">— port —</option>` +
    r.boards.map((b) => `<option value="${esc(b.port)}">${esc(b.port)} (${esc(b.name)})</option>`).join("") +
    (r.by_id || []).map((b) => `<option value="${esc(b.path)}">${esc(b.path.split("/").pop())}</option>`).join("");
  document.querySelectorAll("#ard-sketches select.port").forEach((sel) => (sel.innerHTML = options));
}
$("#ard-refresh").addEventListener("click", (e) => withButton(e.target, loadBoards));

$("#ard-setup").addEventListener("click", (e) => withButton(e.target, async () => {
  const r = await api("POST", "/api/arduino/setup");
  followJob(r.job);
}));

$("#ard-sketches").addEventListener("click", (e) => {
  const card = e.target.closest("[data-sketch]");
  if (!card) return;
  const sketch = card.dataset.sketch;
  if (e.target.dataset.file) {
    withButton(e.target, async () => {
      const f = e.target.dataset.file;
      const r = await api("GET", `/api/arduino/sketches/${sketch}/source/${encodeURIComponent(f)}`);
      $("#source-title").textContent = f;
      $("#source-code").textContent = r.source;
      $("#source-card").classList.remove("hidden");
      $("#source-card").scrollIntoView({ behavior: "smooth" });
    });
  } else if (e.target.dataset.build) {
    const action = e.target.dataset.build;
    const port = $("select.port", card).value;
    if (action === "upload" && !port) { toast("Choisissez le port de la carte", true); return; }
    withButton(e.target, async () => {
      const r = await api("POST", `/api/arduino/${action}`, { sketch, port });
      followJob(r.job);
    });
  }
});
$("#source-close").addEventListener("click", () => $("#source-card").classList.add("hidden"));

async function followJob(id) {
  $("#job-card").classList.remove("hidden");
  $("#job-card").scrollIntoView({ behavior: "smooth" });
  for (;;) {
    const j = await api("GET", `/api/jobs/${id}`);
    $("#job-title").textContent = j.title;
    const st = $("#job-state");
    st.textContent = j.state;
    st.className = "pill " + (j.state === "réussi" ? "ok" : j.state === "échec" ? "bad" : "warn");
    const log = $("#job-log");
    log.textContent = j.log;
    log.scrollTop = log.scrollHeight;
    if (j.state !== "en cours") { toast(j.title + " : " + j.state, j.state !== "réussi"); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ------------------------------------------------------------ jambes
let legsTimer = null;
loaders.legs = async () => {
  try {
    const info = await api("GET", "/api/legs");
    if (!$("#legs-port").value) $("#legs-port").value = info.port;
    $("#legs-poses").innerHTML = info.poses.map((p) => `<button class="ghost" data-pose="${esc(p)}">${esc(p)}</button>`).join("");
    renderLegsStatus(info);
  } catch (e) { toast(e.message, true); }
  clearInterval(legsTimer);
  legsTimer = setInterval(async () => {
    if (currentTab !== "legs") { clearInterval(legsTimer); return; }
    try { renderLegsStatus(await api("GET", "/api/legs")); } catch (_) { /* affiché au prochain clic */ }
  }, 2000);
};

function renderLegsStatus(info) {
  const st = $("#legs-state");
  if (!info.connected) { st.className = "pill"; st.textContent = "non connecté"; $("#legs-status").innerHTML = ""; return; }
  const s = info.status;
  st.className = "pill " + (s.state === "READY" ? "ok" : "bad");
  st.textContent = s.state === "READY" ? "prêt" : "DÉFAUT : " + s.reason;
  const names = Object.fromEntries(Object.entries(info.joints).map(([n, id]) => [id, n]));
  const rows = Object.entries(s.servos).map(([id, v]) => `<tr>
      <td>${esc(names[id] || id)}</td><td>${v.pos}</td><td>${v.load}</td>
      <td class="${v.temp_c >= 55 ? "hot" : ""}">${v.temp_c} °C</td><td>${v.volt.toFixed(1)} V</td></tr>`).join("");
  const imu = s.imu ? `<p class="muted">Bassin : roulis ${s.imu.roll}°, tangage ${s.imu.pitch}° ${s.imu.ok ? "" : "(IMU ABSENTE)"}</p>` : "";
  $("#legs-status").innerHTML = `<table><tr><th>Articulation</th><th>Position</th><th>Charge</th><th>Temp.</th><th>Tension</th></tr>${rows}</table>${imu}`;
}

function legsPost(cmd, extra = {}) {
  return api("POST", `/api/legs/${cmd}`, { gantry_ok: $("#legs-gantry").checked, ...extra });
}
$("#legs-connect").addEventListener("click", (e) => withButton(e.target, async () => {
  await api("POST", "/api/legs/connect", { port: $("#legs-port").value }); toast("Jambes connectées"); loaders.legs();
}));
$("#legs-disconnect").addEventListener("click", (e) => withButton(e.target, async () => {
  await api("POST", "/api/legs/disconnect"); toast("Déconnecté (articulations figées)"); loaders.legs();
}));
$("#legs-hold").addEventListener("click", (e) => withButton(e.target, async () => { await legsPost("hold"); toast("Articulations figées"); }));
$("#legs-reset").addEventListener("click", (e) => withButton(e.target, async () => { await legsPost("reset"); toast("Défaut effacé"); }));
$("#legs-torque-on").addEventListener("click", (e) => withButton(e.target, async () => { await legsPost("torque", { on: true }); toast("Couple activé"); }));
$("#legs-torque-off").addEventListener("click", (e) => withButton(e.target, async () => {
  if (!confirm("Sans couple, le robot ne tient plus debout. Il est bien sur le portique ?")) return;
  await legsPost("torque", { on: false }); toast("Couple coupé");
}));
$("#legs-poses").addEventListener("click", (e) => {
  const pose = e.target.dataset.pose;
  if (!pose) return;
  withButton(e.target, async () => {
    await legsPost("pose", { name: pose, time: Number($("#legs-time").value) || 3000 });
    toast("Pose " + pose + " en cours");
  });
});

// ------------------------------------------------------------ services
loaders.services = async () => {
  const s = await api("GET", "/api/status");
  $("#services-list").innerHTML = Object.entries(s.services).map(([name, v]) => `
    <div class="card" data-service="${esc(name)}">
      <div class="row between"><h2>${esc(v.label)}</h2>${servicePill(v.state)}</div>
      <p class="muted">${esc(name)}.service</p>
      <div class="row wrap">
        <button data-svc="start">Démarrer</button>
        <button class="ghost" data-svc="restart">Redémarrer</button>
        <button class="ghost" data-svc="stop">Arrêter</button>
        <button class="ghost" data-svc="logs">Journal</button>
      </div>
    </div>`).join("");
};
$("#services-list").addEventListener("click", (e) => {
  const action = e.target.dataset.svc;
  if (!action) return;
  const name = e.target.closest("[data-service]").dataset.service;
  withButton(e.target, async () => {
    if (action === "logs") {
      const r = await api("GET", `/api/services/${name}/logs`);
      $("#logs-title").textContent = "Journal de " + name;
      $("#logs-text").textContent = r.logs;
      $("#logs-card").classList.remove("hidden");
      $("#logs-card").scrollIntoView({ behavior: "smooth" });
    } else {
      await api("POST", `/api/services/${name}/${action}`);
      toast(name + " : " + action);
      loaders.services();
    }
  });
});
$("#logs-close").addEventListener("click", () => $("#logs-card").classList.add("hidden"));

// ------------------------------------------------------------ réglages
const SETTING_LABELS = {
  mrl_url: "Adresse de MyRobotLab",
  mrl_dir: "Dossier d'installation de MyRobotLab (contient resource/Arduino/MrlComm)",
  arduino_cli: "Commande arduino-cli",
  robot_config: "Fichier config.json du robot",
  legs_config: "Fichier de configuration des jambes",
};
loaders.settings = async () => {
  const s = await api("GET", "/api/settings");
  $("#settings-form").innerHTML = Object.entries(SETTING_LABELS).map(([k, label]) =>
    `<label>${esc(label)}<input name="${k}" value="${esc(s[k])}"></label>`).join("");
  loadConfig();
};
$("#settings-save").addEventListener("click", (e) => withButton(e.target, async () => {
  const body = {};
  new FormData($("#settings-form")).forEach((v, k) => (body[k] = v));
  await api("PUT", "/api/settings", body);
  toast("Réglages enregistrés");
}));
async function loadConfig() {
  const r = await api("GET", `/api/config/${$("#config-name").value}`);
  $("#config-path").textContent = r.exists ? r.path : `${r.path} (n'existe pas encore : exemple affiché)`;
  $("#config-text").value = r.text;
}
$("#config-name").addEventListener("change", () => loadConfig().catch((e) => toast(e.message, true)));
$("#config-save").addEventListener("click", (e) => withButton(e.target, async () => {
  const r = await api("PUT", `/api/config/${$("#config-name").value}`, { text: $("#config-text").value });
  toast("Enregistré : " + r.path + " (ancienne version en .bak)");
  loadConfig();
}));

// ------------------------------------------------------------ démarrage
showTab("dashboard");
setInterval(() => { if (currentTab === "dashboard") loaders.dashboard(); }, 10000);
