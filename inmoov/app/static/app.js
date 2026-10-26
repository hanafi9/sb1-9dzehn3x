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

// ------------------------------------------------------------ Kamil (interface interactive)
const KAMIL_STATES = {
  off: "Endormi", idle: "En veille — dis « Kamil » pour me parler", awake: "Je t'écoute…",
  thinking: "Je réfléchis…", speaking: "Je parle",
};
const kamil = { timer: null, lastCount: -1, waiting: false, mode: "question" };

function kamilTime(t) {
  const d = new Date(t * 1000);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function kamilRefresh() {
  let k;
  try { k = await api("GET", "/api/kamil"); } catch (e) { return; }
  kamil.state = k;
  const stage = $("#kamil-stage");
  stage.dataset.state = k.state;
  $("#kamil-name").textContent = k.name;
  $("#kamil-status").textContent = KAMIL_STATES[k.state] || k.state;
  // voix arrêtée, ou lancée mais muette depuis 30 s (ancienne version, bloquée) : on propose de la (re)lancer
  if (k.alive) kamil.silentSince = null;
  else if (k.voice_running && !kamil.silentSince) kamil.silentSince = Date.now();
  const stuck = !k.alive && k.voice_running && Date.now() - kamil.silentSince > 30000;
  kamil.alive = k.alive;
  $("#kamil-sleep").classList.toggle("hidden", k.alive || (k.voice_running && !stuck));
  $("#kamil-sleep-text").textContent = stuck
    ? "Kamil est lancé mais ne répond pas à l'Atelier (ancienne version de sa voix ?)."
    : "Kamil dort : sa voix n'est pas lancée.";
  $("#kamil-wake").textContent = stuck ? "Redémarrer Kamil" : "Réveiller Kamil";
  $("#kamil-wake").dataset.action = stuck ? "restart" : "start";
  if (!k.alive && k.voice_running) $("#kamil-status").textContent = "Je me réveille…";

  // infos : voix reconnue, personnes, dernier événement
  $("#kamil-chips").innerHTML = [
    k.voix ? `<span class="pill ok">🎙 ${esc(k.voix)}</span>` : "",
    k.people !== null ? `<span class="pill">👀 ${k.people} personne${k.people > 1 ? "s" : ""}</span>` : "",
    k.journal ? `<span class="pill" title="Dernier événement du journal">📓 ${esc(k.journal)}</span>` : "",
  ].join("");
  if (k.mood) {
    // humeur en jauges circulaires
    const rings = [["Énergie", k.mood.energie, 0, 1, "#f59e0b"], ["Joie", k.mood.joie, -1, 1, "#22c55e"],
                   ["Curiosité", k.mood.curiosite, 0, 1, "#a855f7"]];
    $("#kamil-mood").innerHTML = rings.map(([label, v, lo, hi, color]) => {
      const pct = Math.max(0, Math.min(100, Math.round(100 * ((v ?? lo) - lo) / (hi - lo))));
      return `<div class="ring" style="--v:${pct}%;--c:${color}" title="${label} ${pct} %"><span><b>${pct}</b>${label}</span></div>`;
    }).join("");
  }
  // posture : la tête du dessin suit la position réelle des servos, les yeux la personne suivie
  const v = k.vision;
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  if (v && v.head) {
    stage.style.setProperty("--pan", clamp(((v.head.rothead ?? 90) - 90) / 60).toFixed(3));
    stage.style.setProperty("--tilt", clamp(((v.head.neck ?? 90) - 90) / 30).toFixed(3));
  }
  if (v && v.target_box) {
    const [x0, y0, x1, y1] = v.target_box;
    stage.style.setProperty("--gx", clamp(((x0 + x1) / 2 - 0.5) * 2).toFixed(3));
    stage.style.setProperty("--gy", clamp(((y0 + y1) / 2 - 0.5) * 2).toFixed(3));
    stage.dataset.gaze = "1";
  } else {
    delete stage.dataset.gaze;
  }
  const guard = $("#kamil-guard");
  if (document.activeElement !== guard && k.garde !== undefined && k.garde !== null) guard.checked = !!k.garde;
  $("#kamil-seen").textContent = k.objects && k.objects.length ? "Je vois : " + k.objects.join(", ") : "";

  // conversation
  const h = k.history || [];
  if (h.length !== kamil.lastCount || kamil.waiting) {
    const box = $("#kamil-bubbles");
    const last = h[h.length - 1];
    if (kamil.waiting && last && last.qui === "kamil" && h.length !== kamil.lastCount) kamil.waiting = false;
    box.innerHTML = h.length ? h.map((m) => `<div class="bubble ${m.qui === "toi" ? "toi" : "kamil"}">${esc(m.texte)}
        <small>${m.qui === "toi" ? "Toi" : esc(k.name)} · ${kamilTime(m.t)}</small></div>`).join("") +
      (kamil.waiting || k.state === "thinking" ? '<div class="bubble kamil typing"><span></span><span></span><span></span></div>' : "")
      : `<p class="empty">Dis « ${esc(k.name)} » à voix haute, ou écris-lui en bas.<br>La conversation s'affiche ici en direct.</p>`;
    if (h.length !== kamil.lastCount) box.scrollTop = box.scrollHeight;
    kamil.lastCount = h.length;
  }
}

function kamilCamera() {
  for (const fig of document.querySelectorAll(".kamil-cams figure")) {
    const n = fig.dataset.kcam;
    const cam = (kamil.state?.cameras || [])[n];
    if (!cam || !cam.live) { $(".cam", fig).classList.remove("live"); continue; }
    const img = new Image();   // préchargée : pas de clignotement
    img.onload = () => {
      $("img", fig).src = img.src;
      $(".cam", fig).classList.add("live");
      drawVision($("canvas", fig), kamil.state?.vision, n, img.naturalWidth, img.naturalHeight, $("#kamil-boxes").checked);
    };
    img.src = `/api/bench/camera/${n}.jpg?t=${Date.now()}`;
  }
}

loaders.kamil = () => {
  kamil.lastCount = -1;
  kamilRefresh().then(kamilCamera);
  clearInterval(kamil.timer);
  kamil.timer = setInterval(() => {
    if (currentTab !== "kamil") return clearInterval(kamil.timer);
    kamilRefresh().then(kamilCamera);     // une image par seconde, cadres à jour
  }, 1000);
};

async function kamilSend(text) {
  text = text.trim();
  if (!text) return;
  if (!kamil.alive) return toast("Kamil ne répond pas : redémarre sa voix (bouton sur son visage)", true);
  try {
    await api("POST", `/api/kamil/${kamil.mode}`, { value: text });
    $("#kamil-text").value = "";
    if (kamil.mode === "question") kamil.waiting = true;
    else toast("Kamil va le dire");
    kamilRefresh();
  } catch (e) { toast(e.message, true); }
}
$("#kamil-form").addEventListener("submit", (e) => { e.preventDefault(); kamilSend($("#kamil-text").value); });
$("#kamil-suggest").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;
  const keep = kamil.mode;
  kamil.mode = "question";
  kamilSend(e.target.textContent).finally(() => { kamil.mode = keep; });
});
// un clic sur une caméra l'agrandit (un autre la réduit)
document.querySelectorAll(".kamil-cams figure").forEach((fig) => fig.addEventListener("click", () => {
  const big = !fig.classList.contains("big");
  document.querySelectorAll(".kamil-cams figure").forEach((f) => f.classList.remove("big"));
  fig.classList.toggle("big", big);
  kamilCamera();
}));
$("#kamil-boxes").addEventListener("change", kamilCamera);
document.querySelectorAll(".kamil-mode button").forEach((b) => b.addEventListener("click", () => {
  kamil.mode = b.dataset.mode;
  document.querySelectorAll(".kamil-mode button").forEach((x) => x.classList.toggle("on", x === b));
  $("#kamil-text").placeholder = kamil.mode === "question" ? "Écris à Kamil…" : "Phrase que Kamil dira à voix haute…";
  $("#kamil-text").focus();
}));
$("#kamil-guard").addEventListener("change", async (e) => {
  try { await api("POST", "/api/kamil/garde", { value: e.target.checked });
        toast(e.target.checked ? "Mode garde activé" : "Mode garde désactivé"); }
  catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
});
$("#kamil-wake").addEventListener("click", (e) => withButton(e.target, async () => {
  const action = e.target.dataset.action || "start";
  const r = await api("POST", `/api/programs/voice/${action}`);
  kamil.silentSince = null;
  toast("Kamil : " + r.results.voice + " (environ 10 s)");
}));

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
          `<p class="muted">MyRobotLab n'est pas lancé (il met 20 à 60 s à démarrer).</p>
           <button data-dash-start="mrl">Démarrer MyRobotLab</button>`}
      </div>
      <div class="card"><h2>Matériel</h2>
        <div class="row between"><span>Coral USB</span>${pill(s.coral, "détecté", "absent")}</div>
        <div class="row between"><span>Ports série</span><span>${s.serial_ports.length ? esc(s.serial_ports.join(", ")) : "aucun"}</span></div>
        <div class="row between"><span>Jambes</span>${pill(s.legs_connected, "connectées", "non connectées")}</div>
      </div>
      <div class="card"><h2>Programmes</h2><div id="dash-programs" class="muted">…</div>
        <button class="ghost" data-goto="services">Démarrer / arrêter</button></div>
      <div class="card"><h2>Services systemd</h2>${services}</div>`;
    const pr = await api("GET", "/api/programs");
    $("#dash-programs").innerHTML = pr.order.map((n) => pr.programs[n]).map((p) =>
      `<div class="row between"><span>${esc(p.label)}</span>${!p.installed ? '<span class="pill warn">pas installé</span>'
        : pill(p.running, "en marche", "arrêté")}</div>`).join("");
  } catch (e) { toast(e.message, true); }
  const g = await api("GET", "/api/guide");
  const steps = g.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.phase })));
  const done = steps.filter((s) => g.done[s.id]).length;
  $("#dash-progress-bar").style.width = (100 * done / steps.length) + "%";
  $("#dash-progress-text").textContent = `${done} étape(s) sur ${steps.length}`;
  const next = steps.find((s) => !g.done[s.id]);
  $("#dash-next").innerHTML = next ? `Prochaine étape : <b>${esc(next.phase)} — ${esc(next.title)}</b>` : "Bravo, tout est terminé !";
};

// ------------------------------------------------------------ documentation
let docsChapters = null;   // tous les chapitres (chargés une fois)
let docsOverview = null;   // cartes PCA9685 pour le schéma d'ensemble
let docsCurrent = "start";

function chapterText(c) {
  return c.blocks.map((b) => [b.text, ...(b.items || []).map((i) => (typeof i === "string" ? i : i.title)),
    ...(b.rows || []).flat(), ...(b.headers || [])].join(" ")).join(" ").toLowerCase() + " " + c.title.toLowerCase();
}

function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const i = safe.toLowerCase().indexOf(esc(q).toLowerCase());
  return i < 0 ? safe : safe.slice(0, i) + "<mark>" + safe.slice(i, i + esc(q).length) + "</mark>" + safe.slice(i + esc(q).length);
}

// Schéma électrique détaillé : dessin (SVG généré par le serveur), légende, remarques, liste de câblage.
function renderElectrical(sheet, open = false) {
  const div = document.createElement("div");
  div.className = "el-sheet";
  const legend = sheet.legend.map((l) => `<span><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>`).join("");
  const rows = sheet.rows.map((r) => `<tr><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td>${esc(r.type)}</td>
      <td>${esc(r.color)}</td><td>${esc(r.section)}</td><td>${esc(r.note)}</td></tr>`).join("");
  div.innerHTML = `<p class="muted">${esc(sheet.subtitle)}</p>
    ${open ? sheet.pages.map((pg) => `<div class="el-scroll el-page">${pg}</div>`).join("") : `<div class="el-scroll">${sheet.svg}</div>`}
    <div class="el-legend">${legend}</div>
    ${sheet.notes.length ? `<ul class="el-notes">${sheet.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <details class="el-rows" ${open ? "open" : ""}><summary>Liste de câblage (${sheet.rows.length} fils)</summary>
      <div class="table-wrap"><table><tr><th>De</th><th>À</th><th>Type</th><th>Couleur conseillée</th><th>Section</th><th>Remarque</th></tr>${rows}</table></div>
    </details>`;
  return div;
}

function renderBlock(b, q) {
  const div = document.createElement("div");
  const H = (t) => highlight(t, q);
  switch (b.type) {
    case "p": div.innerHTML = `<p>${H(b.text)}</p>`; break;
    case "h": div.innerHTML = `<h2>${H(b.text)}</h2>`; break;
    case "warn": div.innerHTML = `<div class="callout"><b>⚠ Attention :</b> ${H(b.text)}</div>`; break;
    case "tip": div.innerHTML = `<div class="callout tip"><b>Astuce :</b> ${H(b.text)}</div>`; break;
    case "steps": div.innerHTML = `<ol>${b.items.map((i) => `<li>${H(i)}</li>`).join("")}</ol>`; break;
    case "check": div.innerHTML = `<ul class="checklist">${b.items.map((i) => `<li>${H(i)}</li>`).join("")}</ul>`; break;
    case "cmd": div.innerHTML = b.items.map((c) => `<div class="cmd"><code>${esc(c)}</code><button class="ghost" data-copy="${esc(c)}">Copier</button></div>`).join(""); break;
    case "table": div.innerHTML = `<div class="table-wrap"><table><tr>${b.headers.map((h) => `<th>${H(h)}</th>`).join("")}</tr>${
      b.rows.map((r) => `<tr>${r.map((c) => `<td>${H(c)}</td>`).join("")}</tr>`).join("")}</table></div>`; break;
    case "links": div.innerHTML = `<ul>${b.items.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${H(l.title)}</a></li>`).join("")}</ul>`; break;
    case "tab": div.innerHTML = `<p><button class="ghost" data-goto="${esc(b.tab)}">→ ${esc(b.text)}</button></p>`; break;
    case "overview":
      div.className = "diagram";
      if (docsOverview) div.appendChild(drawOverview(docsOverview.boards, docsOverview.arduino));
      break;
    case "schema":
      div.className = "diagram";
      div.appendChild(drawPart(b.view));
      break;
    case "electrical":
      div.appendChild(renderElectrical(b.sheet));
      break;
    case "servos":
      div.innerHTML = b.view.servos.length ? `<div class="table-wrap"><table><tr><th>Servo</th><th>Service MyRobotLab</th><th>Modèle</th><th>Carte</th><th>Canal</th></tr>${
        b.view.servos.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.service)}</td><td>${esc(s.model)}</td><td>${esc(s.address)}</td><td>CH${s.channel}</td></tr>`).join("")}</table></div>` : "";
      break;
    case "parts": {
      const printed = b.view.printed.map((g) => `<p><b>${esc(g.group)}</b> : ${g.items.map((it, i) =>
        (g.done && g.done[i] ? "✓ " : "") + esc(it)).join(", ")}</p>`).join("");
      div.innerHTML = (b.view.note ? `<p>${esc(b.view.note)}</p>` : "") + printed +
        `<div class="table-wrap"><table><tr><th>Matériel</th><th>Quantité</th></tr>${
          b.view.hardware.map((h) => `<tr><td>${esc(h.item)}</td><td>${esc(h.qty)}</td></tr>`).join("")}</table></div>`;
      break;
    }
  }
  return div;
}

function renderChapter(c, q) {
  const art = document.createElement("section");
  art.className = "doc-chapter card";
  art.innerHTML = `<h1>${esc(c.title)}</h1>`;
  c.blocks.forEach((b) => art.appendChild(renderBlock(b, q)));
  return art;
}

function renderToc() {
  const q = $("#docs-search").value.trim().toLowerCase();
  const list = docsChapters.filter((c) => !q || c._text.includes(q));
  $("#docs-toc").innerHTML = list.length ? list.map((c) =>
    `<button data-chapter="${esc(c.id)}" class="${c.id === docsCurrent ? "active" : ""}">${esc(c.title)}</button>`).join("")
    : `<p class="muted">Aucun résultat.</p>`;
  if (q && list.length && !list.some((c) => c.id === docsCurrent)) showChapter(list[0].id);
  else showChapter(docsCurrent);
}

function showChapter(id) {
  docsCurrent = id;
  const c = docsChapters.find((x) => x.id === id) || docsChapters[0];
  const box = $("#docs-content");
  box.innerHTML = "";
  box.appendChild(renderChapter(c, $("#docs-search").value.trim()));
  document.querySelectorAll("#docs-toc button").forEach((b) => b.classList.toggle("active", b.dataset.chapter === c.id));
}

loaders.docs = async () => {
  if (!docsChapters) {
    const [all, ov] = await Promise.all([api("GET", "/api/manual/all"), api("GET", "/api/schema")]);
    docsOverview = ov;
    docsChapters = all.chapters.map((c) => ({ ...c, _text: chapterText(c) }));
  }
  renderToc();
};
$("#docs-search").addEventListener("input", () => docsChapters && renderToc());
$("#docs-toc").addEventListener("click", (e) => {
  const id = e.target.dataset.chapter;
  if (id) { showChapter(id); window.scrollTo({ top: 0, behavior: "smooth" }); }
});
$("#docs-content").addEventListener("click", async (e) => {
  if (e.target.dataset.goto) showTab(e.target.dataset.goto);
  if (e.target.dataset.copy !== undefined) {
    try { await navigator.clipboard.writeText(e.target.dataset.copy); toast("Commande copiée"); }
    catch (_) { toast("Copie impossible : sélectionnez le texte à la main", true); }
  }
});
$("#docs-print").addEventListener("click", (e) => withButton(e.target, async () => {
  const all = await api("GET", "/api/manual/all");   // version à jour (avancement des pièces)
  buildManualBook(all.chapters);
  window.print();
}));

// Livre complet pour l'impression : page de garde avec sommaire, puis un chapitre par page.
function buildManualBook(chapters) {
  const box = $("#manual-print");
  box.innerHTML = `<section class="doc-chapter"><h1>Manuel du robot InMoov</h1>
    <p>Robot humanoïde InMoov : Raspberry Pi 5, MyRobotLab, Atelier InMoov.<br>
    Version du ${new Date().toLocaleDateString("fr-FR")}.</p>
    <h2>Sommaire</h2><ol>${chapters.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ol>
    <p>Les schémas de câblage, les listes de pièces et les réglages viennent de l'Atelier : réimprimez ce manuel
    après chaque changement de câblage ou de calibration.</p></section>`;
  chapters.forEach((c) => box.appendChild(renderChapter(c, "")));
}

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
    const fs = view.foot_sensors;
    const legsH = 110 + rows * 46;
    const h = legsH + (fs ? 170 : 0);
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
    if (fs) {
      // capteurs d'équilibre : BNO085 (I2C) et 8 HX711 (broches 22 à 37)
      const y = legsH + 20;
      svgLine(svg, `M60 76 V${y + 28} H120`, "sv-i2c");
      svgLine(svg, `M40 76 V${y + 110} H120`, "sv-sig");
      svgBox(svg, 120, y, 300, 56, "sv-box", "BNO085 au centre du bassin", "I2C : SDA 20 / SCL 21 (déjà prévu)");
      svgBox(svg, 120, y + 82, 300, 56, "sv-box", "8 × HX711 (5 V, RATE à 5 V)", "DOUT 22,24…36 · SCK 23,25…37");
      svgLine(svg, `M420 ${y + 110} H520`, "sv-sig");
      svgBox(svg, 520, y + 82, 360, 56, "sv-box", "4 cellules de charge par pied", "une à chaque coin, entre 2 plaques");
    }
    wrap.appendChild(svg);
    wrap.insertAdjacentHTML("beforeend", `<div class="legend"><span class="l-bus">bus chaîné : signal + alimentation, de servo en servo</span>${fs ? `<span class="l-i2c">I2C</span><span class="l-sig">fils de données HX711</span>` : ""}</div>`);
    if (fs) {
      wrap.insertAdjacentHTML("beforeend", `<p>${esc(fs.note)}</p><div class="table-wrap"><table>
        <tr><th>Cellule</th><th>Emplacement</th><th>HX711 DOUT</th><th>HX711 SCK</th></tr>${fs.cells.map((c) =>
        `<tr><td>${esc(c.cell)}</td><td>${esc(c.place)}</td><td>${esc(c.dout)}</td><td>${esc(c.sck)}</td></tr>`).join("")}</table></div>`);
    }
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
  const el = await api("GET", "/api/electrical");
  $("#el-sheets").innerHTML = el.sheets.map((sh) =>
    `<button data-sheet="${esc(sh.id)}" class="${sh.id === elSheet ? "active" : ""}">${esc(sh.title)}</button>`).join("");
  await renderElSheet();
};
let elSheet = "alimentation";

async function renderElSheet() {
  const sheet = await api("GET", `/api/electrical/${elSheet}`);
  document.querySelectorAll("#el-sheets button").forEach((b) => b.classList.toggle("active", b.dataset.sheet === elSheet));
  const box = $("#el-sheet");
  box.innerHTML = `<h2>${esc(sheet.title)}</h2>`;
  box.appendChild(renderElectrical(sheet));
}

$("#el-sheets").addEventListener("click", (e) => {
  const id = e.target.dataset.sheet;
  if (!id) return;
  elSheet = id;
  renderElSheet().catch((err) => toast(err.message, true));
});

// Tous les schémas électriques à imprimer (ou enregistrer en PDF) : un schéma par page, puis sa liste de câblage.
function buildElectricalBook(sheets) {
  const box = $("#manual-print");
  box.innerHTML = `<section class="doc-chapter"><h1>Schémas électriques du robot InMoov</h1>
    <p>Version du ${new Date().toLocaleDateString("fr-FR")}. Générés par l'Atelier InMoov à partir de son plan de câblage.</p>
    <h2>Sommaire</h2><ol>${sheets.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol>
    <p>Chaque schéma est suivi de sa liste de câblage (de → à, type de fil, couleur, section).</p></section>`;
  sheets.forEach((s) => {
    const sec = document.createElement("section");
    sec.className = "doc-chapter";
    sec.innerHTML = `<h1>${esc(s.title)}</h1>`;
    sec.appendChild(renderElectrical(s, true));
    box.appendChild(sec);
  });
}
$("#el-print").addEventListener("click", (e) => withButton(e.target, async () => {
  const all = await api("GET", "/api/electrical/all");
  buildElectricalBook(all.sheets);
  window.print();
}));
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
  const sc = await api("GET", "/api/schema");
  if (!confirm(`Rattacher tous les servos du haut du corps aux ${sc.boards.length} cartes PCA9685 dans MyRobotLab ?\n` +
               `(${sc.boards.map((b) => b.address).join(", ")} — modifiable dans Réglages)\n` +
               "Les cartes doivent être câblées et l'Arduino i01.left connectée.")) return;
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
    $("#legs-sequences").innerHTML = info.sequences.map((p) => `<button class="ghost" data-sequence="${esc(p)}">${esc(p)}</button>`).join("");
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
  renderSequence(info.sequence);
  if (!info.connected) {
    st.className = "pill"; st.textContent = "non connecté"; $("#legs-status").innerHTML = "";
    renderFeet(null); return;
  }
  const s = info.status;
  st.className = "pill " + (s.state === "READY" ? "ok" : "bad");
  st.textContent = s.state === "READY" ? "prêt" : "DÉFAUT : " + s.reason;
  const names = Object.fromEntries(Object.entries(info.joints).map(([n, id]) => [id, n]));
  const rows = Object.entries(s.servos).map(([id, v]) => `<tr>
      <td>${esc(names[id] || id)}</td><td>${v.pos}</td><td>${v.load}</td>
      <td class="${v.temp_c >= 55 ? "hot" : ""}">${v.temp_c} °C</td><td>${v.volt.toFixed(1)} V</td></tr>`).join("");
  const imu = s.imu ? `<p class="muted">Bassin : roulis ${s.imu.roll}°, tangage ${s.imu.pitch}° ${s.imu.ok ? "" : "(IMU ABSENTE)"}</p>` : "";
  renderFeet(s.feet);
  $("#legs-status").innerHTML = `<div class="table-wrap"><table><tr><th>Articulation</th><th>Position</th><th>Charge</th><th>Temp.</th><th>Tension</th></tr>${rows}</table></div>${imu}`;
}

const BALANCE_LABELS = ["arrêté", "ACTIF", "surveillance"];

function renderSequence(seq) {
  if (!seq || !seq.name) { $("#legs-seq-state").textContent = ""; return; }
  $("#legs-seq-state").textContent = seq.running ? `Séquence ${seq.name} en cours… (FIGER pour arrêter)`
    : seq.error ? `Séquence ${seq.name} arrêtée : ${seq.error}` : `Séquence ${seq.name} terminée.`;
}

// Vue de dessus des deux pieds : poids et centre de pression (pointes en haut).
function footSvg(label, kg, copX, copY, outsideLeft) {
  const cx = 50 + (outsideLeft ? -copY : copY) * 30, cy = 80 - copX * 60;
  return `<figure><svg viewBox="0 0 100 160" role="img" aria-label="${esc(label)}">
      <rect x="15" y="10" width="70" height="140" rx="30" class="foot"/>
      <line x1="50" y1="14" x2="50" y2="146" class="foot-axis"/><line x1="18" y1="80" x2="82" y2="80" class="foot-axis"/>
      ${kg > 0.2 ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" class="cop"/>` : ""}
    </svg><figcaption>${esc(label)}<br><b>${kg.toFixed(1)} kg</b></figcaption></figure>`;
}

function renderFeet(f) {
  const mode = $("#feet-mode");
  if (!f) { mode.className = "pill"; mode.textContent = "—"; $("#feet-view").innerHTML = ""; return; }
  mode.className = "pill " + (f.balance === 1 ? "ok" : "");
  mode.textContent = "équilibre " + (BALANCE_LABELS[f.balance] || "?");
  const total = f.g_kg + f.d_kg;
  const share = total > 0.5 ? Math.round(100 * f.g_kg / total) : null;
  $("#feet-view").innerHTML = (f.ok ? "" : `<p class="warn">Cellules absentes ou non étalonnées : faites la tare puis l'étalonnage (voir Documentation → Jambes).</p>`)
    + `<div class="row wrap">${footSvg("Pied gauche", f.g_kg, f.g_cop_x, f.g_cop_y, true)}${footSvg("Pied droit", f.d_kg, f.d_cop_x, f.d_cop_y, false)}
      <div class="muted">Appui : ${share === null ? "pieds en l'air" : `${share} % gauche / ${100 - share} % droite`}<br>
      Correction chevilles : tangage ${f.corr_tangage.toFixed(1)}°, roulis ${f.corr_roulis.toFixed(1)}°<br>
      Bassin : roulis ${f.roll.toFixed(1)}°, tangage ${f.pitch.toFixed(1)}°</div></div>`;
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
$("#legs-sequences").addEventListener("click", (e) => {
  const name = e.target.dataset.sequence;
  if (!name) return;
  withButton(e.target, async () => { await legsPost("sequence", { name }); toast("Séquence " + name + " lancée"); });
});
document.querySelectorAll("[data-balance]").forEach((b) => b.addEventListener("click", (e) => withButton(e.target, async () => {
  await legsPost("balance", { mode: e.target.dataset.balance });
  toast("Équilibre : " + e.target.textContent);
})));
$("#feet-tare").addEventListener("click", (e) => withButton(e.target, async () => {
  if (!confirm("Les deux pieds sont-ils en l'air (robot suspendu au portique) ?")) return;
  await legsPost("tare"); toast("Tare faite");
}));

$("#legs-poses").addEventListener("click", (e) => {
  const pose = e.target.dataset.pose;
  if (!pose) return;
  withButton(e.target, async () => {
    await legsPost("pose", { name: pose, time: Number($("#legs-time").value) || 3000 });
    toast("Pose " + pose + " en cours");
  });
});

$("#dash-cards").addEventListener("click", (e) => {
  if (e.target.dataset.goto) showTab(e.target.dataset.goto);
  const name = e.target.dataset.dashStart;
  if (name) withButton(e.target, async () => {
    let r = await api("POST", `/api/programs/${name}/start`);
    if (r.results[name] === "déjà en marche" && confirm("MyRobotLab tourne déjà mais ne répond pas. Le redémarrer ?"))
      r = await api("POST", `/api/programs/${name}/restart`);
    toast("MyRobotLab : " + r.results[name] + " (patientez 20 à 60 s)");
    setTimeout(() => loaders.dashboard(), 20000);
  });
});

// ------------------------------------------------------------ programmes (sans systemd)
let logsTimer = null;
function showLogs(title, url) {
  clearInterval(logsTimer);
  const refresh = async () => {
    if ($("#logs-card").classList.contains("hidden")) return clearInterval(logsTimer);
    try {
      const r = await api("GET", url);
      const pre = $("#logs-text");
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
      pre.textContent = r.logs;
      if (atEnd) pre.scrollTop = pre.scrollHeight;     // suit la fin du journal
    } catch (e) { clearInterval(logsTimer); }
  };
  $("#logs-title").textContent = title;
  $("#logs-text").textContent = "…";
  $("#logs-card").classList.remove("hidden");
  $("#logs-card").scrollIntoView({ behavior: "smooth" });
  refresh().then(() => { $("#logs-text").scrollTop = $("#logs-text").scrollHeight; });
  logsTimer = setInterval(refresh, 3000);
}

function since(s) {
  if (s === null || s === undefined) return "";
  return s < 90 ? ` depuis ${s} s` : s < 5400 ? ` depuis ${Math.round(s / 60)} min` : ` depuis ${Math.round(s / 3600)} h`;
}

loaders.programs = async () => {
  const r = await api("GET", "/api/programs");
  $("#programs-list").innerHTML = r.order.map((name) => [name, r.programs[name]]).map(([name, p]) => `
    <div class="card" data-program="${esc(name)}">
      <div class="row between"><h2>${esc(p.label)}</h2>
        ${!p.installed ? '<span class="pill warn">pas installé</span>' :
          p.running ? `<span class="pill ok">en marche${esc(since(p.since_s))}</span>` : '<span class="pill bad">arrêté</span>'}
      </div>
      ${p.problem ? `<p class="muted">${esc(p.problem)}</p>` : ""}
      <div class="row wrap">
        <button data-prog="start" ${p.running || !p.installed ? "disabled" : ""}>Démarrer</button>
        <button class="ghost" data-prog="restart" ${!p.installed ? "disabled" : ""}>Redémarrer</button>
        <button class="ghost" data-prog="stop" ${!p.running ? "disabled" : ""}>Arrêter</button>
        <button class="ghost" data-prog="logs">Journal</button>
      </div>
      <label class="check"><input type="checkbox" data-autostart ${r.autostart.includes(name) ? "checked" : ""}
        ${!p.installed ? "disabled" : ""}> au démarrage de l'Atelier</label>
    </div>`).join("");
};
$("#programs-list").addEventListener("click", (e) => {
  const action = e.target.dataset.prog;
  if (!action) return;
  const card = e.target.closest("[data-program]");
  const name = card.dataset.program;
  withButton(e.target, async () => {
    if (action === "logs") return showLogs("Journal : " + card.querySelector("h2").textContent, `/api/programs/${name}/logs`);
    const r = await api("POST", `/api/programs/${name}/${action}`);
    toast(card.querySelector("h2").textContent + " : " + r.results[name]);
    if (action !== "stop") setTimeout(() => showLogs("Journal : " + card.querySelector("h2").textContent,
                                                      `/api/programs/${name}/logs`), 800);
    loaders.programs();
  });
});
$("#programs-list").addEventListener("change", async (e) => {
  if (!e.target.matches("[data-autostart]")) return;
  const names = [...document.querySelectorAll("#programs-list [data-autostart]:checked")]
    .map((c) => c.closest("[data-program]").dataset.program);
  try { await api("PUT", "/api/programs/autostart", { names }); toast("Démarrage automatique enregistré"); }
  catch (err) { toast(err.message, true); }
});
for (const [id, action] of [["#prog-start-all", "start"], ["#prog-stop-all", "stop"]]) {
  $(id).addEventListener("click", (e) => withButton(e.target, async () => {
    const r = await api("POST", `/api/programs/all/${action}`);
    toast(Object.entries(r.results).map(([n, v]) => `${n} : ${v}`).join(" · "));
    loaders.programs();
  }));
}

// ------------------------------------------------------------ services
loaders.services = async () => {
  loaders.programs().catch((e) => toast(e.message, true));
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
      showLogs("Journal de " + name, `/api/services/${name}/logs`);
    } else {
      await api("POST", `/api/services/${name}/${action}`);
      toast(name + " : " + action);
      loaders.services();
    }
  });
});
$("#logs-close").addEventListener("click", () => { clearInterval(logsTimer); $("#logs-card").classList.add("hidden"); });

// ------------------------------------------------------------ réglages
const SETTING_LABELS = {
  mrl_url: "Adresse de MyRobotLab",
  mrl_dir: "Dossier d'installation de MyRobotLab (contient myrobotlab.sh et resource/Arduino/MrlComm)",
  mrl_args: "Options au lancement de MyRobotLab (vide en général ; ex. --config inmoov2)",
  arduino_cli: "Commande arduino-cli",
  robot_config: "Fichier config.json du robot",
  legs_config: "Fichier de configuration des jambes",
};
loaders.settings = async () => {
  const s = await api("GET", "/api/settings");
  const cards = [["3", "3 cartes (montage définitif)"], ["2", "2 cartes (montage provisoire : côté droit sur les voies libres)"]];
  $("#settings-form").innerHTML = Object.entries(SETTING_LABELS).map(([k, label]) =>
    `<label>${esc(label)}<input name="${k}" value="${esc(s[k])}"></label>`).join("") +
    `<label>Cartes PCA9685 branchées<select name="pca_cartes">${cards.map(([v, t]) =>
      `<option value="${v}"${String(s.pca_cartes) === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
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
// mode kiosque : /kiosk (ou ?kiosk) = Kamil seul, en plein écran, sans barre ni onglets
// plein écran (comme F11) : le navigateur ne l'accepte qu'après un clic ou un toucher
const KIOSK = location.pathname === "/kiosk" || new URLSearchParams(location.search).has("kiosk");
if (KIOSK) document.body.classList.add("kiosk");
function enterFullscreen() {
  document.body.classList.add("kiosk");      // affichage Kamil seul, sans barre ni onglets
  showTab("kamil");
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) Promise.resolve(req.call(el)).catch(() => toast("Le navigateur refuse le plein écran : appuie sur F11", true));
  else toast("Plein écran non disponible ici : appuie sur F11", true);
}
function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!KIOSK) document.body.classList.remove("kiosk");
}
$("#fullscreen-btn").addEventListener("click", enterFullscreen);
$("#kiosk-exit").addEventListener("click", (e) => {
  if (KIOSK) return;                  // page /kiosk : le lien ramène à l'Atelier
  e.preventDefault();                 // plein écran ouvert depuis l'Atelier : on en sort simplement
  exitFullscreen();
});
$("#kiosk-full").addEventListener("click", () => (document.fullscreenElement ? exitFullscreen() : enterFullscreen()));
document.addEventListener("fullscreenchange", () => {
  const full = !!document.fullscreenElement;
  $("#kiosk-full").textContent = full ? "✕ Quitter le plein écran" : "⛶ Plein écran";
  $("#kiosk-hint").classList.add("hidden");
  if (!full && !KIOSK) document.body.classList.remove("kiosk");   // Échap : retour à l'Atelier
});
if (KIOSK && !document.fullscreenElement) {
  // page /kiosk : le premier toucher de l'écran passe en plein écran
  $("#kiosk-hint").classList.remove("hidden");
  const first = (e) => {
    if (e.target.closest("button, input, a, label")) return;   // un vrai clic sur un bouton reste un clic
    document.removeEventListener("pointerdown", first, true);
    enterFullscreen();
  };
  document.addEventListener("pointerdown", first, true);
  setTimeout(() => $("#kiosk-hint").classList.add("hidden"), 8000);
}
showTab("kamil");
setInterval(() => { if (currentTab === "dashboard") loaders.dashboard(); }, 10000);

// ------------------------------------------------------------ banc d'essai
const bench = { groups: [], results: {}, state: null, part: null, timer: null, camTimer: null, sweeps: new Set() };

loaders.bench = async () => {
  try {
    bench.groups = (await api("GET", "/api/servos")).groups;
  } catch (e) { toast(e.message, true); }
  await benchRefresh();
  if (!bench.part) benchSelect("head");
  clearInterval(bench.timer);
  clearInterval(bench.camTimer);
  // rafraîchit seulement tant que l'onglet est affiché
  bench.timer = setInterval(() => (currentTab === "bench" ? benchRefresh() : clearInterval(bench.timer)), 2000);
  bench.camTimer = setInterval(() => (currentTab === "bench" ? benchCameras() : clearInterval(bench.camTimer)), 500);
};

$("#bench-status").addEventListener("click", (e) => {
  const name = e.target.dataset.benchStart;
  if (!name) return;
  withButton(e.target, async () => {
    const out = $("#bench-prog-log");
    try {
      let r = await api("POST", `/api/programs/${name}/start`);
      if (r.results[name] === "déjà en marche") {
        // le programme existe mais ne répond pas (ex. MyRobotLab bloqué depuis des heures)
        if (!confirm("Ce programme tourne déjà mais ne répond pas. Le redémarrer ?")) return;
        r = await api("POST", `/api/programs/${name}/restart`);
      }
      toast(r.results[name] + (name === "mrl" ? " : MyRobotLab met 20 à 60 s à démarrer…" : " : on vérifie dans 8 s…"));
    } catch (err) {                       // ex. environnement Python absent : la raison s'affiche
      out.textContent = err.message;
      out.classList.remove("hidden");
      return;
    }
    if (name === "mrl") {
      // MyRobotLab : on attend qu'il réponde vraiment (jusqu'à 2 min), en montrant où il en est
      for (let t = 0; t < 120; t += 5) {
        await new Promise((ok) => setTimeout(ok, 5000));
        const st = await api("GET", "/api/bench/state");
        const pr = (await api("GET", "/api/programs")).programs.mrl;
        if (st.mrl) { out.classList.add("hidden"); toast("MyRobotLab connecté"); benchRefresh(); return; }
        if (!pr.running) break;                       // il s'est arrêté : on montre pourquoi
        out.textContent = `MyRobotLab démarre… (${t + 5} s)\n\n` + (await api("GET", "/api/programs/mrl/logs")).logs
          .split("\n").slice(-8).join("\n");
        out.classList.remove("hidden");
      }
      out.textContent = "MyRobotLab ne répond pas. Fin de son journal :\n\n" + (await api("GET", "/api/programs/mrl/logs")).logs;
      out.classList.remove("hidden");
      return;
    }
    await new Promise((ok) => setTimeout(ok, 8000));
    const p = (await api("GET", "/api/programs")).programs[name];
    if (p.running) { out.classList.add("hidden"); toast(p.label + " : en marche"); benchRefresh(); return; }
    // le programme s'est arrêté tout de suite : on montre la fin de son journal
    out.textContent = p.label + " s'est arrêté. Fin du journal :\n\n" + (await api("GET", `/api/programs/${name}/logs`)).logs;
    out.classList.remove("hidden");
  });
});

async function benchRefresh() {
  let s;
  try { s = await api("GET", "/api/bench/state"); } catch (e) { return; }
  bench.state = s;
  bench.results = s.results || {};
  const v = s.vision;
  $("#bench-status").innerHTML = [
    pill(s.mrl, "MyRobotLab connecté", "MyRobotLab injoignable"),
    s.mrl ? "" : '<button class="ghost" data-bench-start="mrl">Démarrer MyRobotLab</button>',
    pill(s.voice, "voix lancée", "voix arrêtée"),
    s.voice ? "" : '<button class="ghost" data-bench-start="voice">Démarrer la voix</button>',
    pill(s.tracker, "suivi de visage lancé", "suivi de visage arrêté"),
    s.tracker ? "" : '<button class="ghost" data-bench-start="vision">Démarrer le suivi</button>',
    pill(s.coral, "Coral détecté", "Coral absent", "Coral : inconnu"),
  ].join(" ");
  if (!v) {
    $("#bench-vision").textContent = "Lancez face_tracker.py (vision) pour voir les caméras et ce que détecte le Coral.";
  } else {
    const objs = (v.objects || []).map((o) => `${esc(o.label)} (${esc(o.side)}, ${Math.round(o.score * 100)} %)`).join(", ");
    const objs2 = (v.camera2?.objects || []).map((o) => `${esc(o.label)} (${esc(o.side)})`).join(", ");
    const move = (m) => (m && m.level > 0.01 ? `<b>oui</b> (${Math.round(m.level * 100)} % de l'image)` : "non");
    const follow = { visage: "son visage", silhouette: "sa silhouette (visage pas visible)" }[v.tracking] || "personne";
    $("#bench-vision").innerHTML = `${v.fresh ? "" : "<b>Image figée</b> · "}Visages : <b>${v.faces || 0}</b>
      · Personnes : <b>${v.people ?? v.faces ?? 0}</b> · La tête suit : <b>${follow}</b>
      · rothead ${esc(v.head?.rothead)}, neck ${esc(v.head?.neck)}${v.tracking_paused ? " (suivi en pause)" : ""}
      <br>Caméra 1 — objets : ${objs || "aucun"} · mouvement : ${move(v.motion)}
      ${v.camera2 ? `<br>Caméra 2 — objets : ${objs2 || "aucun"} · mouvement : ${move(v.camera2.motion)}` : ""}
      <br><span class="muted">Cadres : vert = visage, bleu = objet, orange = mouvement</span>`;
  }
  if (s.second_camera_index === null || s.second_camera_index === undefined) {
    $('[data-cam="1"] .cam-off').textContent = "Réglez vision.second_camera_index dans config.json (ex. 2) puis relancez face_tracker.py";
  }
  benchColorZones();
  if (bench.part) benchMarks();
}

function benchCameras() {
  for (const fig of document.querySelectorAll(".bench-cams figure")) {
    const n = fig.dataset.cam;
    const cam = (bench.state?.cameras || [])[n];
    $(".cam-age", fig).textContent = cam && cam.age_s !== null ? `(il y a ${cam.age_s} s)` : "";
    if (!cam || !cam.live) { $(".cam", fig).classList.remove("live"); continue; }
    const img = new Image();   // préchargée : pas de clignotement
    img.onload = () => {
      $("img", fig).src = img.src;
      $(".cam", fig).classList.add("live");
      benchBoxes(fig, n, img.naturalWidth, img.naturalHeight);
    };
    img.src = `/api/bench/camera/${n}.jpg?t=${Date.now()}`;
  }
}

// Cadres des visages (vert) et des objets (bleu) détectés par le Coral, sur la caméra du suivi
function benchBoxes(fig, n, natW, natH) {
  drawVision($("canvas", fig), bench.state?.vision, String(n), natW, natH, $("#bench-boxes").checked);
}

// Dessine sur l'image d'une caméra : zone centrale et cible suivies (caméra 1), visages, objets, mouvements
function drawVision(canvas, v, n, natW, natH, show) {
  const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (!v || !show || !natW) return;
  const seen = n === "0" ? v : (v.camera2 || {});   // la 2e caméra a ses propres détections
  // zone réelle de l'image : entière et centrée (contain), ou remplissant le cadre en débordant (cover, kiosque)
  const img = canvas.parentElement.querySelector("img");
  const cover = img && getComputedStyle(img).objectFit === "cover";
  const scale = cover ? Math.max(w / natW, h / natH) : Math.min(w / natW, h / natH);
  const iw = natW * scale, ih = natH * scale, ox = (w - iw) / 2, oy = (h - ih) / 2;
  const draw = (b, color, label) => {
    const [x0, y0, x1, y1] = b;
    ctx.strokeStyle = color; ctx.lineWidth = color === "#facc15" ? 3 : 2;
    ctx.strokeRect(ox + x0 * iw, oy + y0 * ih, (x1 - x0) * iw, (y1 - y0) * ih);
    ctx.font = "12px system-ui";
    const tx = ox + x0 * iw, ty = Math.max(0, oy + y0 * ih - 16);
    ctx.fillStyle = color;   // étiquette sur fond plein, lisible sur toute image
    ctx.fillRect(tx, ty, ctx.measureText(label).width + 6, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, tx + 3, ty + 12);
  };
  if (n === "0" && v.deadband) {
    // zone centrale : quand la cible y est, la tête ne bouge plus
    const [dx, dy] = v.deadband;
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(229,231,235,.8)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + (0.5 - dx / 2) * iw, oy + (0.5 - dy / 2) * ih, dx * iw, dy * ih);
    ctx.setLineDash([]); ctx.beginPath();
    ctx.moveTo(ox + iw / 2 - 8, oy + ih / 2); ctx.lineTo(ox + iw / 2 + 8, oy + ih / 2);
    ctx.moveTo(ox + iw / 2, oy + ih / 2 - 8); ctx.lineTo(ox + iw / 2, oy + ih / 2 + 8);
    ctx.stroke(); ctx.restore();
  }
  ((seen.motion || {}).boxes || []).forEach((b) => draw(b, "#f97316", "mouvement"));
  (seen.objects || []).filter((o) => o.box).forEach((o) => draw(o.box, "#3b82f6", o.label));
  if (n === "0") (v.face_boxes || []).forEach((b) => draw(b, "#22c55e", `visage ${Math.round(b[4] * 100)} %`));
  if (n === "0" && v.target_box) {
    // la cible suivie, et le trait jusqu'au centre : ce que la tête cherche à rattraper
    const [x0, y0, x1, y1] = v.target_box;
    const cx = ox + (x0 + x1) / 2 * iw, cy = oy + (y0 + y1) / 2 * ih;
    ctx.save(); ctx.lineWidth = 3; draw(v.target_box, "#facc15", "suivi : " + (v.tracking || "cible"));
    ctx.strokeStyle = "rgba(250,204,21,.85)"; ctx.setLineDash([3, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox + iw / 2, oy + ih / 2); ctx.lineTo(cx, cy); ctx.stroke(); ctx.restore();
  }
}

function benchGroupStatus(g) {
  const r = g.servos.map((s) => bench.results[s.service]);
  if (r.includes("bad")) return "bad";
  if (r.every((x) => x === "ok")) return "ok";
  return r.some((x) => x) ? "part" : "";
}
function benchColorZones() {
  document.querySelectorAll("#bench-robot .zone").forEach((z) => {
    const g = bench.groups.find((x) => x.key === z.dataset.group);
    z.classList.remove("ok", "bad", "part");
    const st = g ? benchGroupStatus(g) : "";
    if (st) z.classList.add(st);
    z.classList.toggle("selected", z.dataset.group === bench.part);
  });
}

function benchSelect(key) {
  const g = bench.groups.find((x) => x.key === key);
  if (!g) return;
  bench.part = key;
  benchColorZones();
  $("#bench-part").innerHTML = `
    <div class="row between wrap"><h2>${esc(g.label)}</h2>
      <div class="row wrap"><button data-bact="sweep-all">Tester toute la partie</button>
      <button class="ghost" data-bact="rest-all">Repos</button></div></div>
    <p class="muted">Le curseur bouge le servo en direct (0-180, limité par la calibration de l'onglet Servos).
      « Tester » le fait aller d'un côté puis de l'autre, puis revenir au repos.</p>
    ${g.servos.map((s) => `
      <div class="bench-servo" data-service="${esc(s.service)}" data-rest="${s.rest}">
        <div class="row between"><b>${esc(s.label)}</b>
          <span class="muted">PCA ${esc(s.pca.address)} canal ${s.pca.channel}</span></div>
        <div class="row"><input type="range" min="0" max="180" value="${s.rest}" aria-label="position de ${esc(s.label)}">
          <span class="pos">${s.rest}</span></div>
        <div class="row wrap">
          <button class="ghost" data-bact="sweep">Tester</button>
          <button class="ghost" data-bact="rest">Repos</button>
          <span style="flex:1"></span>
          <button class="ghost mark" data-bact="ok" title="fonctionne">✓</button>
          <button class="ghost mark" data-bact="bad" title="problème">✗</button>
        </div>
      </div>`).join("")}`;
  benchMarks();
}

function benchMarks() {
  document.querySelectorAll("#bench-part .bench-servo").forEach((d) => {
    const r = bench.results[d.dataset.service];
    $('[data-bact="ok"]', d).classList.toggle("on-ok", r === "ok");
    $('[data-bact="bad"]', d).classList.toggle("on-bad", r === "bad");
  });
}

$("#bench-robot").addEventListener("click", (e) => {
  const z = e.target.closest(".zone");
  if (z) benchSelect(z.dataset.group);
});
$("#bench-robot").addEventListener("keydown", (e) => {
  const z = e.target.closest(".zone");
  if (z && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); benchSelect(z.dataset.group); }
});

const benchSliderTimers = new Map();
$("#bench-part").addEventListener("input", (e) => {
  if (e.target.type !== "range") return;
  const d = e.target.closest(".bench-servo"), service = d.dataset.service;
  $(".pos", d).textContent = e.target.value;
  if (benchSliderTimers.has(service)) return;
  benchSliderTimers.set(service, setTimeout(() => benchSliderTimers.delete(service), 150));
  sendMove(service, e.target.value);
});
$("#bench-part").addEventListener("change", (e) => {
  if (e.target.type === "range") sendMove(e.target.closest(".bench-servo").dataset.service, e.target.value);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function benchMove(d, pos) {
  $("input[type=range]", d).value = pos;
  $(".pos", d).textContent = pos;
  await api("POST", `/api/servos/${encodeURIComponent(d.dataset.service)}/move`, { pos });
}
// Balayage doux : repos → 20 → 160 → repos (la calibration empêche de dépasser les butées)
async function benchSweep(d) {
  const rest = Number(d.dataset.rest);
  for (const pos of [rest, 20, 160, rest]) {
    if (bench.stopped) return;
    await benchMove(d, pos);
    await sleep(1200);
  }
}

$("#bench-part").addEventListener("click", (e) => {
  const act = e.target.dataset.bact;
  if (!act) return;
  const d = e.target.closest(".bench-servo");
  withButton(e.target, async () => {
    bench.stopped = false;
    if (act === "sweep") await benchSweep(d);
    else if (act === "rest") await benchMove(d, Number(d.dataset.rest));
    else if (act === "sweep-all") {
      for (const s of document.querySelectorAll("#bench-part .bench-servo")) await benchSweep(s);
    } else if (act === "rest-all") {
      for (const s of document.querySelectorAll("#bench-part .bench-servo")) await benchMove(s, Number(s.dataset.rest));
    } else if (act === "ok" || act === "bad") {
      const cur = bench.results[d.dataset.service];
      const r = await api("PUT", `/api/bench/results/${encodeURIComponent(d.dataset.service)}`,
        { result: cur === act ? "" : act });
      bench.results = r.results;
      benchMarks();
      benchColorZones();
    }
  });
});

$("#bench-rest-all").addEventListener("click", (e) => withButton(e.target, async () => {
  const r = await api("POST", "/api/bench/all/rest");
  toast(r.errors.length ? r.errors[0] : "Tous les servos vont au repos", r.errors.length > 0);
}));
$("#bench-stop").addEventListener("click", (e) => withButton(e.target, async () => {
  bench.stopped = true;   // interrompt les balayages en cours
  const r = await api("POST", "/api/bench/all/disable");
  toast(r.errors.length ? r.errors[0] : "Tous les servos sont coupés (désactivés)", r.errors.length > 0);
}));

document.querySelectorAll("[data-speaker]").forEach((b) => b.addEventListener("click", () => withButton(b, async () => {
  await api("POST", "/api/bench/speaker", { side: b.dataset.speaker });
})));
$("#bench-say-btn").addEventListener("click", (e) => withButton(e.target, async () => {
  await api("POST", "/api/bench/speak", { text: $("#bench-say").value });
}));
$("#bench-mic-btn").addEventListener("click", (e) => withButton(e.target, async () => {
  $("#bench-mic-text").textContent = "Parlez…";
  try {
    const r = await api("POST", "/api/bench/mic");
    $("#bench-mic-bar").style.width = Math.min(100, r.peak) + "%";
    $("#bench-mic-text").textContent = r.peak < 3 ? `Presque rien entendu (${r.peak} %) : micro coupé ou trop bas ?`
      : r.peak > 95 ? `Saturé (${r.peak} %) : baissez le gain (alsamixer)` : `OK : crête ${r.peak} %`;
  } catch (err) {
    $("#bench-mic-text").textContent = "";
    throw err;
  }
}));
