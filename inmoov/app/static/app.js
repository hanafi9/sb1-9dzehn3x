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

// ------------------------------------------------------------ schémas
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function svgBox(svg, x, y, w, h, cls, title, sub) {
  svg.appendChild(svgEl("rect", { x, y, width: w, height: h, rx: 8, class: cls }));
  svg.appendChild(svgEl("text", { x: x + 10, y: y + (sub ? 20 : h / 2 + 5), class: "sv-b" }, title));
  if (sub) svg.appendChild(svgEl("text", { x: x + 10, y: y + 38, class: "sv-s" }, sub));
}
const svgLine = (svg, d, cls) => svg.appendChild(svgEl("path", { d, class: cls }));

// Vue d'ensemble : Pi 5, Mega + 3 PCA9685, Mega des jambes, alimentations.
function drawOverview(boards, arduino) {
  const svg = svgEl("svg", { viewBox: "0 0 900 470", role: "img", "aria-label": "Architecture électronique" });
  svgBox(svg, 20, 190, 150, 56, "sv-ctrl", "Raspberry Pi 5", "MyRobotLab, Atelier");
  svgBox(svg, 240, 90, 190, 56, "sv-ctrl", "Arduino Mega", arduino + " · MrlComm");
  svgBox(svg, 240, 300, 190, 56, "sv-ctrl", "Arduino Mega n°2", "jambes · inmoov_legs");
  svgLine(svg, "M170 205 H205 V118 H240", "sv-bus");
  svgLine(svg, "M170 232 H205 V328 H240", "sv-bus");
  svg.appendChild(svgEl("text", { x: 178, y: 160, class: "sv-s" }, "USB"));
  svg.appendChild(svgEl("text", { x: 178, y: 290, class: "sv-s" }, "USB"));
  // trois cartes PCA9685
  boards.forEach((b, i) => {
    const y = 20 + i * 76;
    svgBox(svg, 520, y, 220, 56, "sv-board", `PCA9685 ${b.address}`, b.label.replace(/^Carte \w : /, ""));
    svgLine(svg, `M430 118 H475 V${y + 28} H520`, "sv-i2c");
  });
  svg.appendChild(svgEl("text", { x: 438, y: 108, class: "sv-s" }, "I2C"));
  // jambes : bus chaîné
  svgBox(svg, 520, 300, 220, 56, "sv-box", "12 servos bus Feetech", "6 par jambe, 1 seul câble chaîné");
  svgLine(svg, "M430 328 H520", "sv-bus");
  svg.appendChild(svgEl("text", { x: 440, y: 318, class: "sv-s" }, "bus série"));
  // alimentations
  svgBox(svg, 762, 20, 128, 56, "sv-power", "6 V 20 A", "+ fusibles");
  svgLine(svg, `M762 48 H752 V${48 + (boards.length - 1) * 76}`, "sv-pwr");
  boards.forEach((b, i) => svgLine(svg, `M752 ${48 + i * 76} H740`, "sv-pwr"));
  svgBox(svg, 762, 300, 128, 56, "sv-power", "12 V", "servos jambes");
  svgBox(svg, 762, 395, 128, 56, "sv-power", "Arrêt urgence", "coupe le 12 V");
  svgLine(svg, "M762 328 H740", "sv-pwr");
  svgLine(svg, "M826 395 V356", "sv-pwr");
  svgBox(svg, 20, 395, 380, 56, "sv-box", "Masses (GND) toutes reliées", "Pi, Arduino, cartes PCA9685, alimentations");
  const wrap = document.createElement("div");
  wrap.appendChild(svg);
  wrap.insertAdjacentHTML("beforeend", `<div class="legend"><span class="l-i2c">I2C (4 fils)</span><span class="l-pwr">alimentation servos</span><span class="l-bus">USB / bus série</span></div>`);
  return wrap;
}

// Schéma d'une partie : chaque carte, ses canaux, et les servos branchés dessus.
function drawPart(view) {
  const wrap = document.createElement("div");
  if (view.i2c_devices) {
    const devs = view.i2c_devices;
    const h = 100 + devs.length * 48;
    const svg = svgEl("svg", { viewBox: `0 0 900 ${h}`, role: "img", "aria-label": "Bus I2C des capteurs" });
    svgBox(svg, 20, 20, 260, 56, "sv-ctrl", "Raspberry Pi 5 · I2C n°1", "broche 3 SDA · broche 5 SCL · 3,3 V");
    svgLine(svg, `M150 76 V${100 + (devs.length - 1) * 48 + 18}`, "sv-i2c");
    devs.forEach((d, i) => {
      const y = 100 + i * 48;
      svgLine(svg, `M150 ${y + 18} H300`, "sv-i2c");
      svg.appendChild(svgEl("rect", { x: 300, y, width: 580, height: 36, rx: 6, class: "sv-box" }));
      svg.appendChild(svgEl("text", { x: 312, y: y + 23, class: "sv-b" }, `${d.address} · ${d.name}`));
      svg.appendChild(svgEl("text", { x: 600, y: y + 23, class: "sv-s" }, d.pins));
    });
    wrap.appendChild(svg);
    wrap.insertAdjacentHTML("beforeend", `<div class="legend"><span class="l-i2c">bus I2C (4 fils : 3,3 V, GND, SDA, SCL)</span></div>
      <div class="table-wrap"><table><tr><th>Capteur</th><th>Adresse</th><th>Réglage</th><th>Rôle</th></tr>${devs.map((d) =>
      `<tr><td>${esc(d.name)}</td><td>${esc(d.address)}</td><td>${esc(d.pins)}</td><td>${esc(d.role)}</td></tr>`).join("")}</table></div>`);
    return wrap;
  }
  if (view.leg_servos) {
    const legs = view.leg_servos;
    const rows = Math.ceil(legs.length / 2);
    const h = 110 + rows * 46;
    const svg = svgEl("svg", { viewBox: `0 0 900 ${h}`, role: "img", "aria-label": "Câblage des jambes" });
    svgBox(svg, 20, 20, 200, 56, "sv-ctrl", "Arduino Mega n°2", "Serial1 TX18 / RX19");
    svgBox(svg, 260, 20, 200, 56, "sv-box", "Adaptateur bus", "half-duplex / RS485");
    svgLine(svg, "M220 48 H260", "sv-bus");
    svgBox(svg, 640, 20, 240, 56, "sv-power", "12 V via arrêt d'urgence", "+ et − sur le même câble bus");
    [0, 1].forEach((col) => {
      const x = col === 0 ? 120 : 520;
      const items = legs.filter((_, i) => (i < rows) === (col === 0));
      svgLine(svg, `M360 76 V96 H${x + 20} V${110 + (items.length - 1) * 46 + 18}`, "sv-bus");
      items.forEach((l, i) => {
        const y = 110 + i * 46;
        svgBox(svg, x, y, 300, 36, "sv-box", `ID ${l.id} · ${l.name}`);
      });
    });
    wrap.appendChild(svg);
    wrap.insertAdjacentHTML("beforeend", `<div class="legend"><span class="l-bus">bus chaîné : signal + alimentation, de servo en servo</span></div>`);
    return wrap;
  }
  if (!view.servos.length) return wrap;
  const ROW = 34, top = 80, HEAD = 56;
  let y0 = top;
  const blocks = view.boards.map((b) => {
    const servos = view.servos.filter((s) => s.board === b.name);
    const blk = { b, servos, y: y0, h: HEAD + servos.length * ROW + 6 };
    y0 += blk.h + 30;
    return blk;
  });
  const svg = svgEl("svg", { viewBox: `0 0 900 ${y0}`, role: "img", "aria-label": "Câblage de la partie" });
  svgBox(svg, 40, 10, 230, 50, "sv-ctrl", "Arduino Mega (i01.left)", "I2C : SDA 20 / SCL 21");
  svgBox(svg, 620, 10, 260, 50, "sv-power", "Bornier 6 V + fusible", "+ et − de chaque servo");
  blocks.forEach(({ b, servos, y, h }) => {
    svgBox(svg, 40, y, 230, h, "sv-board", `PCA9685 ${b.address}`, `${b.name} · ${b.jumpers}`);
    svgLine(svg, `M40 35 H20 V${y + 28} H40`, "sv-i2c");
    servos.forEach((s, i) => {
      const ry = y + HEAD + i * ROW + 12;
      svg.appendChild(svgEl("text", { x: 222, y: ry + 4, class: "sv-t" }, "CH" + s.channel));
      svgLine(svg, `M270 ${ry} H520`, "sv-sig");
      svgLine(svg, `M560 ${ry} H520`, "sv-pwr-thin");
      svg.appendChild(svgEl("circle", { cx: 560, cy: ry, r: 3, class: "sv-dot" }));
      svg.appendChild(svgEl("rect", { x: 300, y: ry - 13, width: 210, height: 26, rx: 6, class: "sv-box" }));
      svg.appendChild(svgEl("text", { x: 308, y: ry + 4, class: "sv-t" }, s.label.length > 30 ? s.label.slice(0, 29) + "…" : s.label));
      svg.appendChild(svgEl("text", { x: 590, y: ry + 4, class: "sv-s" }, s.model.length > 45 ? s.model.slice(0, 44) + "…" : s.model));
    });
    svgLine(svg, `M560 60 V${y + HEAD + (servos.length - 1) * ROW + 12}`, "sv-pwr");
  });
  wrap.appendChild(svg);
  wrap.insertAdjacentHTML("beforeend", `<div class="legend"><span class="l-i2c">I2C</span><span class="l-sig">signal (canal de la carte)</span><span class="l-pwr">+ / − depuis le bornier 6 V</span></div>`);
  return wrap;
}

let schemaPart = "tete";
loaders.schema = async () => {
  const o = await api("GET", "/api/schema");
  const ov = $("#schema-overview");
  ov.innerHTML = "";
  ov.appendChild(drawOverview(o.boards, o.arduino));
  const script = await fetch("/api/schema/mrl_script").then((r) => r.text());
  $("#schema-script").textContent = script;
  $("#schema-parts").innerHTML = o.parts.map((p) =>
    `<button data-part="${esc(p.key)}" class="${p.key === schemaPart ? "active" : ""}">${esc(p.label)}</button>`).join("");
  schemaStlViewer = o.stl_viewer;
  await renderSchemaPart();
};
let schemaStlViewer = "";

async function renderSchemaPart() {
  const v = await api("GET", `/api/schema/${schemaPart}`);
  document.querySelectorAll("#schema-parts button").forEach((b) => b.classList.toggle("active", b.dataset.part === schemaPart));
  const servoRows = v.servos.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.service)}</td><td>${esc(s.model)}</td>
      <td>${esc(s.address)}</td><td>CH${s.channel}</td></tr>`).join("");
  const legRows = (v.leg_servos || []).map((l) => `<tr><td>${esc(l.name)}</td><td>ID ${l.id}</td><td>${esc(l.model)}</td></tr>`).join("");
  const printed = (v.note ? `<p>${esc(v.note)}</p>` : "") + v.printed.map((g) => {
    const n = g.done.filter(Boolean).length;
    return `<div class="parts-group"><div class="row between"><h3>${esc(g.group)}</h3><span class="pill ${n === g.items.length ? "ok" : ""}">${n}/${g.items.length}</span></div>
      <div class="parts-list">${g.items.map((it, i) => `<label class="${g.done[i] ? "done" : ""}">
        <input type="checkbox" data-group="${esc(g.group)}" data-item="${esc(it)}" ${g.done[i] ? "checked" : ""}> ${esc(it)}</label>`).join("")}</div></div>`;
  }).join("");
  const hardware = v.hardware.map((h) => `<tr><td>${esc(h.item)}</td><td>${esc(h.qty)}</td></tr>`).join("");
  const links = [...v.pages, ["Galerie STL officielle (liste complète)", schemaStlViewer]]
    .map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ");
  const el = $("#schema-part");
  el.innerHTML = `
    <div class="card"><h2>${esc(v.label)}</h2><p>${esc(v.summary)}</p><div class="diagram" id="schema-diagram"></div></div>
    ${servoRows ? `<div class="card"><h2>Servos et branchements</h2><div class="table-wrap"><table>
      <tr><th>Servo</th><th>Service MyRobotLab</th><th>Modèle d'origine</th><th>Carte</th><th>Canal</th></tr>${servoRows}</table></div></div>` : ""}
    ${legRows ? `<div class="card"><h2>Servos des jambes</h2><div class="table-wrap"><table>
      <tr><th>Articulation</th><th>Identifiant bus</th><th>Modèle</th></tr>${legRows}</table></div></div>` : ""}
    <div class="card"><h2>Pièces imprimées</h2>
      <p class="muted">Liste principale relevée dans la documentation InMoov : vérifiez les versions à jour dans la galerie officielle. Cochez au fur et à mesure.</p>
      ${printed}<p>${links}</p></div>
    <div class="card"><h2>Matériel</h2><div class="table-wrap"><table><tr><th>Élément</th><th>Quantité</th></tr>${hardware}</table></div></div>`;
  $("#schema-diagram").appendChild(drawPart(v));
}

$("#schema-parts").addEventListener("click", (e) => {
  const key = e.target.dataset.part;
  if (!key) return;
  schemaPart = key;
  renderSchemaPart().catch((err) => toast(err.message, true));
});
$("#schema-part").addEventListener("change", async (e) => {
  const { group, item } = e.target.dataset;
  if (!item) return;
  try {
    await api("POST", `/api/schema/${schemaPart}/printed`, { group, item, done: e.target.checked });
    await renderSchemaPart();
  } catch (err) { toast(err.message, true); }
});
$("#schema-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#schema-script").textContent); toast("Script copié"); }
  catch (_) { toast("Copie impossible : sélectionnez le texte à la main", true); }
});
$("#schema-apply").addEventListener("click", (e) => withButton(e.target, async () => {
  if (!confirm("Rattacher tous les servos du haut du corps aux cartes PCA9685 dans MyRobotLab ?\nLes cartes doivent être câblées et l'Arduino i01.left connectée.")) return;
  const r = await api("POST", "/api/schema/apply", { confirm: true });
  toast(`Câblage appliqué (${r.calls} commandes). Pensez à « Enregistrer la config MyRobotLab ».`);
}));

// ------------------------------------------------------------ capteurs
const FINGER_LABELS = { thumb: "Pouce", index: "Index", majeure: "Majeur", ringFinger: "Annulaire", pinky: "Auriculaire" };
const fmt = (v, d = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
function meter(ratio, warnAt = 0.7, badAt = 0.9) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  const cls = r >= badAt ? "bad" : r >= warnAt ? "warn" : "";
  return `<div class="meter ${cls}"><div style="width:${(r * 100).toFixed(0)}%"></div></div>`;
}

let sensorsTimer = null;
async function refreshSensors() {
  let s;
  try { s = await api("GET", "/api/sensors"); }
  catch (e) {
    $("#sens-state").className = "pill bad"; $("#sens-state").textContent = "injoignable";
    $("#sens-boards").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    return false;
  }
  const faults = Object.values(s.boards).filter((b) => b.fault).length;
  $("#sens-state").className = "pill " + (faults ? "bad" : "ok");
  $("#sens-state").textContent = faults ? `${faults} carte(s) en défaut` : "tout va bien";
  $("#sens-boards").innerHTML = Object.entries(s.boards).map(([name, b]) => `
    <div class="card"><div class="row between"><h3>${esc(name)}</h3>
      ${b.fault ? `<button class="stop" data-reset="${esc(name)}">Réarmer</button>` : b.error ? `<span class="pill warn">capteur absent</span>` : `<span class="pill ok">OK</span>`}</div>
      <div class="stat"><span>Courant</span><span class="big">${fmt(b.amps)} A</span></div>
      ${meter((b.amps || 0) / b.max_current_a)}
      <div class="stat"><span>Tension</span><span>${fmt(b.volts, 2)} V</span></div>
      <div class="stat"><span>Limite</span><span>${b.max_current_a} A</span></div>
      ${b.fault ? `<p class="muted">⚠ ${esc(b.fault)}</p>` : ""}${b.error ? `<p class="muted">${esc(b.error)}</p>` : ""}
    </div>`).join("");
  const bat = s.battery;
  $("#sens-battery").innerHTML = !bat ? `<p class="muted">Non configurée.</p>` : bat.error ? `<p class="muted">${esc(bat.error)}</p>` : `
    <div class="stat"><span>Charge (approximative)</span><span class="big">${fmt(bat.percent, 0)} %</span></div>
    ${(() => { const pc = bat.percent || 0; const cls = pc <= 20 ? "bad" : pc <= 40 ? "warn" : "";
      return `<div class="meter ${cls}"><div style="width:${pc}%"></div></div>`; })()}
    <div class="stat"><span>Tension</span><span>${fmt(bat.volts, 2)} V</span></div>
    <div class="stat"><span>Courant</span><span>${fmt(bat.amps)} A</span></div>
    ${bat.low ? `<p><span class="pill bad">batterie faible</span></p>` : ""}`;
  const p = s.presence;
  $("#sens-presence").innerHTML = `<div class="stat"><span>Personne la plus proche</span>
    <span class="big">${p.distance_mm ? (p.distance_mm / 1000).toFixed(2) + " m" : "—"}</span></div>
    <p>${p.present ? `<span class="pill ok">quelqu'un est là</span>` : `<span class="pill">personne</span>`}</p>`;
  const sides = { left: "Main gauche", right: "Main droite" };
  $("#sens-touch").innerHTML = Object.entries(sides).map(([side, label]) => `
    <div class="card"><h3>${label}</h3>${Object.entries(FINGER_LABELS).map(([f, l]) => {
      const v = s.touch[`${side}.${f}`];
      return `<div class="stat"><span>${l}</span><span>${v === undefined || v === null ? "—" : (v * 100).toFixed(0) + " %"}</span></div>${meter(v || 0, 0.35, 0.8)}`;
    }).join("")}</div>`).join("");
  return true;
}
loaders.sensors = async () => {
  await refreshSensors();
  clearInterval(sensorsTimer);
  sensorsTimer = setInterval(() => {
    if (currentTab !== "sensors") { clearInterval(sensorsTimer); return; }
    refreshSensors();
  }, 1000);
};
$("#sens-boards").addEventListener("click", (e) => {
  const board = e.target.dataset.reset;
  if (!board) return;
  withButton(e.target, async () => {
    if (!confirm(`La cause de la surintensité sur ${board} est-elle corrigée ?`)) return;
    await api("POST", "/api/sensors/reset", { board });
    toast("Carte réarmée : réactivez les servos (onglet Servos)");
    refreshSensors();
  });
});
document.querySelectorAll("[data-grip]").forEach((b) => b.addEventListener("click", (e) => withButton(e.target, async () => {
  const r = await api("POST", "/api/sensors/grip", { side: e.target.dataset.grip, threshold: Number($("#grip-threshold").value) });
  toast(r.touching && r.touching.length ? "Objet saisi (" + r.touching.map((f) => FINGER_LABELS[f]).join(", ") + ")" : "Main fermée, aucun contact détecté");
})));

// ------------------------------------------------------------ IA
loaders.ai = async () => {
  const a = await api("GET", "/api/ai");
  const on = (v, yes, no = "désactivé") => v ? `<span class="pill ok">${esc(yes)}</span>` : `<span class="pill">${esc(no)}</span>`;
  $("#ai-status").innerHTML = `
    <div class="stat"><span>Claude (en ligne)</span>${on(a.claude, a.model || "activé")}</div>
    <div class="stat"><span>Vision (outil « look »)</span>${on(a.vision, "activée")}</div>
    <div class="stat"><span>IA locale de secours</span>${on(a.local, a.local_model || "activée")}</div>
    <div class="stat"><span>Voix</span>${on(true, a.tts === "piper" ? "Piper (hors ligne)" : "MyRobotLab")}</div>
    <div class="stat"><span>LED d'état</span>${on(a.leds, "activées")}</div>
    <div class="stat"><span>Gestes InMoov2 autorisés</span><span>${a.inmoov_gestures.length ? esc(a.inmoov_gestures.join(", ")) : "aucun"}</span></div>`;
  $("#ai-memory").innerHTML = a.memory.length ? a.memory.map((m, i) => `
    <div class="list-row"><span><b>${esc(m.person)}</b> : ${esc(m.fact)}</span>
      <button class="ghost" data-forget="${i}">Oublier</button></div>`).join("") : `<p class="muted">Aucun souvenir pour l'instant.</p>`;
  $("#ai-gestures").innerHTML = a.recorded.length ? a.recorded.map((g) => `
    <div class="list-row"><span>${esc(g)}</span><span class="row">
      <button data-play="${esc(g)}">Jouer</button><button class="ghost" data-delgesture="${esc(g)}">Supprimer</button></span></div>`).join("")
    : `<p class="muted">Aucun geste enregistré.</p>`;
};
$("#ai-memory").addEventListener("click", (e) => {
  const i = e.target.dataset.forget;
  if (i === undefined) return;
  withButton(e.target, async () => { await api("DELETE", `/api/ai/memory/${i}`); loaders.ai(); });
});
$("#ai-clear").addEventListener("click", (e) => withButton(e.target, async () => {
  if (!confirm("Effacer tous les souvenirs du robot ?")) return;
  await api("POST", "/api/ai/memory/clear"); loaders.ai();
}));
$("#ai-gestures").addEventListener("click", (e) => {
  const { play, delgesture } = e.target.dataset;
  if (play) withButton(e.target, async () => {
    const r = await api("POST", `/api/ai/gestures/${encodeURIComponent(play)}/play`, { speed: Number($("#ai-speed").value) || 1 });
    toast(`Geste « ${play} » lancé (${r.steps} consignes)`);
  });
  if (delgesture) withButton(e.target, async () => {
    if (!confirm(`Supprimer le geste « ${delgesture} » ?`)) return;
    await api("DELETE", `/api/ai/gestures/${encodeURIComponent(delgesture)}`); loaders.ai();
  });
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
      <div class="meta">${esc(s.service)} · ${esc(s.pca.model)}<br>PCA9685 ${esc(s.pca.address)} canal ${s.pca.channel}
        <span title="câblage d'origine sans carte PCA9685">(sans PCA : broche ${esc(s.pin)} de ${esc(s.board)})</span></div>
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
