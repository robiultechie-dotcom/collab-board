(() => {
  const root = document.getElementById("studio");
  if (!root) return;

  const BOARD_ID = Number(root.dataset.boardId);
  const OWNER = root.dataset.owner || "";
  const USER = root.dataset.user || "";
  const CLIENT_ID = Math.random().toString(36).slice(2, 10);
  const CSRF = document.querySelector("meta[name=csrf-token]")?.content;

  let pages = JSON.parse(root.dataset.pages || "[]");
  let permissions = JSON.parse(root.dataset.perms || "[]");
  let accessLevel = root.dataset.access || "manager";
  let currentPageId = Number(pages[0]?.id);
  let lastKnownVersion = Number(pages[0]?.version || 0);

  let tool = "pen", currentColor = "#0f172a", penWidth = 4, eraserWidth = 28;
  let isRemote = false, isPointerDown = false, isPanning = false;
  let isSavingNow = false, pendingSave = false;
  let draft = null, startX = 0, startY = 0, panX = 0, panY = 0, sub = null;

  const eraserRing = document.getElementById("eraserRing");
  const sizeFlyout = document.getElementById("sizeFlyout");
  const sizeSlider = document.getElementById("sizeSlider");
  const sizeValueBadge = document.getElementById("sizeValueBadge");
  const dockSizeBadge = document.getElementById("dockSizeBadge");
  const sizeTitle = document.getElementById("sizeTitle");
  const syncText = document.getElementById("syncText");

  const canvas = new fabric.Canvas("boardCanvas", {
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#ffffff",
    preserveObjectStacking: true
  });

  const makeUid = () => CLIENT_ID + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

  const getCaps = () => {
    if (USER.toLowerCase() === OWNER.toLowerCase()) return { role: "owner", edit: true, pages: true, perms: true };
    const p = permissions.find(x => x.nickname.toLowerCase() === USER.toLowerCase());
    const role = p ? p.role : (accessLevel || "manager");
    return { role, edit: ["editor", "manager", "owner"].includes(role), pages: ["manager", "owner"].includes(role), perms: role === "owner" };
  };

  let caps = getCaps();

  const refreshUI = () => {
    caps = getCaps();
    document.getElementById("roleBadge").textContent = caps.role;
    document.getElementById("addPageBtn").disabled = !caps.pages;
    document.getElementById("delPageBtn").disabled = !caps.pages || pages.length <= 1;
    document.querySelectorAll(".edit-tool").forEach(b => b.disabled = !caps.edit);
    if (!caps.edit && !["select", "pan"].includes(tool)) setTool("pan");
    renderPerms();
  };

  window.addEventListener("resize", () => {
    canvas.setWidth(window.innerWidth);
    canvas.setHeight(window.innerHeight);
    canvas.renderAll();
  });

  const serializeCanvas = () => {
    const jsonObj = canvas.toJSON(["uid", "isEraser"]);
    jsonObj.background = "#ffffff";
    return JSON.stringify(jsonObj);
  };

  const performDatabaseSave = () => {
    if (isRemote || !caps.edit) return;
    if (isSavingNow) { pendingSave = true; return; }

    isSavingNow = true;
    pendingSave = false;
    if (syncText) { syncText.textContent = "Saving..."; syncText.className = "text-warning fw-medium"; }

    const json = serializeCanvas();
    const vpt = canvas.viewportTransform.slice();
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const thumb = canvas.toDataURL({ format: "jpeg", quality: 0.35, multiplier: 0.1 });
    canvas.setViewportTransform(vpt);

    const pg = pages.find(p => Number(p.id) === Number(currentPageId));
    if (pg) pg.canvas_data = json;

    fetch("/boards/" + BOARD_ID + "/save_page", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: JSON.stringify({ client_id: CLIENT_ID, nickname: USER, page_id: currentPageId, canvas_data: json, thumbnail: thumb })
    })
      .then(r => r.json())
      .then(res => {
        if (res && res.version) lastKnownVersion = Number(res.version);
        if (syncText) { syncText.textContent = "Saved"; syncText.className = "text-success fw-medium"; }
      })
      .catch(() => {
        if (syncText) { syncText.textContent = "Saved"; syncText.className = "text-success fw-medium"; }
      })
      .finally(() => {
        isSavingNow = false;
        if (pendingSave) { pendingSave = false; performDatabaseSave(); }
      });
  };

  let saveDebounce = null;
  const triggerSync = (actionType, fabricObj = null) => {
    if (isRemote || !caps.edit) return;
    if (sub && actionType) {
      let objJson = null, objUid = null;
      if (fabricObj) {
        if (!fabricObj.uid) fabricObj.uid = makeUid();
        objUid = fabricObj.uid;
        objJson = JSON.stringify(fabricObj.toJSON(["uid", "isEraser"]));
      }
      sub.perform("draw_delta", { client_id: CLIENT_ID, page_id: currentPageId, action_type: actionType, object_uid: objUid, object_json: objJson });
    }
    if (syncText) { syncText.textContent = "Saving..."; syncText.className = "text-warning fw-medium"; }
    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(performDatabaseSave, 100);
  };

  const applyObjectPermissions = (o) => {
    if (o.isEraser || o.stroke === "#ffffff") {
      o.isEraser = true; o.selectable = false; o.evented = false;
    } else {
      o.selectable = caps.edit && tool === "select"; o.evented = true;
    }
  };

  const applyFullRemoteCanvas = (rawJson, version = null) => {
    if (!rawJson || isPointerDown) return;
    isRemote = true;
    if (version) lastKnownVersion = Number(version);
    let parsed = rawJson;
    if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch (_) {} }
    const pg = pages.find(p => Number(p.id) === Number(currentPageId));
    if (pg) pg.canvas_data = typeof rawJson === "string" ? rawJson : JSON.stringify(rawJson);

    canvas.loadFromJSON(parsed, () => {
      canvas.backgroundColor = "#ffffff";
      canvas.forEachObject(o => { if (!o.uid) o.uid = makeUid(); applyObjectPermissions(o); });
      canvas.renderAll();
      isRemote = false;
    });
  };

  const applyRemoteDelta = (data) => {
    if (isPointerDown) return;
    isRemote = true;
    if (data.action_type === "clear") {
      canvas.clear(); canvas.backgroundColor = "#ffffff"; canvas.renderAll(); isRemote = false; return;
    }
    if (data.action_type === "remove" && data.object_uid) {
      const target = canvas.getObjects().find(o => o.uid === data.object_uid);
      if (target) canvas.remove(target);
      canvas.renderAll(); isRemote = false; return;
    }
    if (!data.object_json) { isRemote = false; return; }
    let rawObj = null;
    try { rawObj = JSON.parse(data.object_json); } catch (_) { isRemote = false; return; }
    if (data.object_uid) {
      const existing = canvas.getObjects().find(o => o.uid === data.object_uid);
      if (existing) canvas.remove(existing);
    }
    fabric.util.enlivenObjects([rawObj], (objs) => {
      objs.forEach(o => { applyObjectPermissions(o); canvas.add(o); });
      canvas.renderAll(); isRemote = false;
    });
  };

  const loadPage = (id) => {
    const pg = pages.find(p => Number(p.id) === Number(id)) || pages[0];
    if (!pg) return;
    currentPageId = Number(pg.id);
    lastKnownVersion = Number(pg.version || 0);
    applyFullRemoteCanvas(pg.canvas_data || "{\"version\":\"5.3.0\",\"objects\":[],\"background\":\"#ffffff\"}", lastKnownVersion);
    document.getElementById("pageIndicator").textContent = (pages.findIndex(p => Number(p.id) === currentPageId) + 1) + " / " + pages.length;
    refreshUI();
  };

  const updateSizeState = () => {
    const activeWidth = (tool === "eraser") ? eraserWidth : penWidth;
    sizeTitle.textContent = (tool === "eraser") ? "Eraser Size" : "Pen Size";
    sizeSlider.value = activeWidth;
    sizeValueBadge.textContent = activeWidth + " px";
    dockSizeBadge.textContent = activeWidth;
    document.querySelectorAll(".size-preset-pill").forEach(pill => {
      pill.classList.toggle("active", Math.abs(parseInt(pill.dataset.val, 10) - activeWidth) <= 2);
    });
    if (canvas.isDrawingMode && canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = activeWidth;
  };

  const setTool = (next) => {
    if (!caps.edit && !["select", "pan"].includes(next)) return;
    tool = next;
    document.querySelectorAll(".tool-btn[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
    if (tool === "pen") {
      canvas.isDrawingMode = true; canvas.selection = false;
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = currentColor; canvas.freeDrawingBrush.width = penWidth; canvas.freeDrawingBrush.decimate = 4;
      eraserRing.style.display = "none";
    } else if (tool === "eraser") {
      canvas.isDrawingMode = true; canvas.selection = false;
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = "#ffffff"; canvas.freeDrawingBrush.width = eraserWidth; canvas.freeDrawingBrush.decimate = 5;
    } else {
      canvas.isDrawingMode = false; eraserRing.style.display = "none";
      canvas.selection = (tool === "select" && caps.edit);
    }
    canvas.forEachObject(o => applyObjectPermissions(o));
    canvas.discardActiveObject(); canvas.renderAll(); updateSizeState();
  };

  document.querySelectorAll(".tool-btn[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  document.getElementById("sizeToggleBtn").addEventListener("click", () => {
    sizeFlyout.style.display = (sizeFlyout.style.display === "block") ? "none" : "block";
  });

  sizeSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    if (tool === "eraser") eraserWidth = val;
    else {
      penWidth = val;
      const activeObj = canvas.getActiveObject();
      if (activeObj && caps.edit && activeObj.strokeWidth !== undefined) {
        activeObj.set("strokeWidth", penWidth); canvas.renderAll(); triggerSync("modify", activeObj);
      }
    }
    updateSizeState();
  });

  document.querySelectorAll(".size-preset-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const val = parseInt(pill.dataset.val, 10);
      if (tool === "eraser") eraserWidth = val; else penWidth = val;
      updateSizeState();
    });
  });

  document.querySelectorAll(".color-dot").forEach(d => d.addEventListener("click", () => {
    currentColor = d.dataset.color;
    document.querySelectorAll(".color-dot").forEach(x => x.classList.toggle("active", x === d));
    if (tool === "pen" && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = currentColor;
    const activeObj = canvas.getActiveObject();
    if (activeObj && caps.edit) {
      if (activeObj.type === "i-text") activeObj.set("fill", currentColor);
      else activeObj.set({ stroke: currentColor });
      canvas.renderAll(); triggerSync("modify", activeObj);
    }
  }));

  canvas.on("mouse:down", (opt) => {
    const e = opt.e;
    if (tool === "pan" || e.altKey) { isPanning = true; panX = e.clientX; panY = e.clientY; return; }
    if (!caps.edit) return;
    isPointerDown = true;
    if (["select", "pen", "eraser"].includes(tool)) return;
    const pt = canvas.getPointer(e); startX = pt.x; startY = pt.y;
    if (tool === "text") {
      isPointerDown = false;
      const txt = new fabric.IText("Text", { left: startX, top: startY, fontSize: 26, fill: currentColor, uid: makeUid() });
      canvas.add(txt); canvas.setActiveObject(txt); setTool("select"); txt.enterEditing(); txt.selectAll();
      triggerSync("add", txt); return;
    }
    const base = { left: startX, top: startY, stroke: currentColor, strokeWidth: penWidth, fill: currentColor + "22", selectable: false, uid: makeUid() };
    if (tool === "rect") draft = new fabric.Rect({ ...base, width: 1, height: 1 });
    else if (tool === "circle") draft = new fabric.Ellipse({ ...base, rx: 1, ry: 1 });
    else if (tool === "line") draft = new fabric.Line([startX, startY, startX, startY], { stroke: currentColor, strokeWidth: penWidth, selectable: false, uid: makeUid() });
    if (draft) canvas.add(draft);
  });

  let lastCursorSent = 0;
  canvas.on("mouse:move", (opt) => {
    const e = opt.e, pt = canvas.getPointer(e);
    if (tool === "eraser") {
      const d = eraserWidth * canvas.getZoom();
      eraserRing.style.display = "block"; eraserRing.style.width = d + "px"; eraserRing.style.height = d + "px";
      eraserRing.style.left = e.clientX + "px"; eraserRing.style.top = e.clientY + "px";
    } else eraserRing.style.display = "none";

    if (sub && Date.now() - lastCursorSent > 50) {
      lastCursorSent = Date.now();
      sub.perform("cursor_move", { client_id: CLIENT_ID, page_id: currentPageId, x: Math.round(pt.x), y: Math.round(pt.y) });
    }
    if (isPanning) {
      canvas.viewportTransform[4] += e.clientX - panX; canvas.viewportTransform[5] += e.clientY - panY;
      canvas.requestRenderAll(); panX = e.clientX; panY = e.clientY; return;
    }
    if (!draft) return;
    const w = Math.abs(pt.x - startX), h = Math.abs(pt.y - startY), l = Math.min(pt.x, startX), t = Math.min(pt.y, startY);
    if (tool === "line") draft.set({ x2: pt.x, y2: pt.y });
    else if (tool === "circle") draft.set({ left: l, top: t, rx: w / 2, ry: h / 2 });
    else draft.set({ left: l, top: t, width: w, height: h });
    canvas.renderAll();
  });

  canvas.on("mouse:out", () => { eraserRing.style.display = "none"; });
  canvas.on("mouse:up", () => {
    isPanning = false; isPointerDown = false;
    if (draft) { draft.setCoords(); const fin = draft; draft = null; triggerSync("add", fin); }
  });

  canvas.on("path:created", (opt) => {
    isPointerDown = false;
    const path = opt.path; path.uid = makeUid();
    if (tool === "eraser") { path.isEraser = true; path.set({ selectable: false, evented: false }); }
    triggerSync("add", path);
  });
  canvas.on("object:modified", (opt) => { isPointerDown = false; if (opt.target) triggerSync("modify", opt.target); });
  canvas.on("text:changed", (opt) => { if (opt.target) triggerSync("modify", opt.target); });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!caps.edit) return;
    const active = canvas.getActiveObjects();
    if (active.length) {
      active.forEach(o => { canvas.remove(o); triggerSync("remove", o); });
      canvas.discardActiveObject(); canvas.renderAll();
    } else {
      canvas.clear(); canvas.backgroundColor = "#ffffff"; canvas.renderAll(); triggerSync("clear");
    }
  });

  document.getElementById("prevPageBtn").addEventListener("click", () => {
    const i = pages.findIndex(p => Number(p.id) === currentPageId);
    if (i > 0) loadPage(pages[i - 1].id);
  });
  document.getElementById("nextPageBtn").addEventListener("click", () => {
    const i = pages.findIndex(p => Number(p.id) === currentPageId);
    if (i < pages.length - 1) loadPage(pages[i + 1].id);
  });
  document.getElementById("addPageBtn").addEventListener("click", () => {
    fetch("/boards/" + BOARD_ID + "/add_page", { method: "POST", headers: { "X-CSRF-Token": CSRF } })
      .then(r => r.json()).then(d => { if (d.page) { pages.push(d.page); loadPage(d.page.id); } });
  });
  document.getElementById("delPageBtn").addEventListener("click", () => {
    if (pages.length > 1) fetch("/boards/" + BOARD_ID + "/pages/" + currentPageId, { method: "DELETE", headers: { "X-CSRF-Token": CSRF } });
  });

  const zoomTo = (z) => {
    const c = Math.min(Math.max(z, 0.3), 3);
    canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, c);
    document.getElementById("zoomText").textContent = Math.round(c * 100) + "%";
  };
  document.getElementById("zoomInBtn").addEventListener("click", () => zoomTo(canvas.getZoom() * 1.2));
  document.getElementById("zoomOutBtn").addEventListener("click", () => zoomTo(canvas.getZoom() / 1.2));
  document.getElementById("zoomResetBtn").addEventListener("click", () => { canvas.setViewportTransform([1,0,0,1,0,0]); document.getElementById("zoomText").textContent = "100%"; });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "board-" + BOARD_ID + "-frame.jpg";
    link.href = canvas.toDataURL({ format: "jpeg", quality: 0.95 });
    link.click();
  });

  const renderPerms = () => {
    document.getElementById("accessLevelSelect").value = accessLevel;
    const ul = document.getElementById("permList");
    ul.innerHTML = permissions.length ? "" : "<li class=\"list-group-item text-muted text-center\">No custom user roles</li>";
    permissions.forEach(p => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = "<span><strong>" + p.nickname + "</strong> (" + p.role + ")</span>" + (caps.perms ? "<button class=\"btn btn-sm text-danger p-0\">Remove</button>" : "");
      li.querySelector("button")?.addEventListener("click", () => updatePerm({ target_nickname: p.nickname, role: "remove" }));
      ul.appendChild(li);
    });
  };
  const updatePerm = (body) => fetch("/boards/" + BOARD_ID + "/update_permissions", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF }, body: JSON.stringify(body) });
  document.getElementById("accessLevelSelect")?.addEventListener("change", (e) => updatePerm({ access_level: e.target.value }));
  document.getElementById("savePermBtn")?.addEventListener("click", () => {
    const nick = document.getElementById("targetNickInput").value.trim();
    if (nick) updatePerm({ target_nickname: nick, role: document.getElementById("targetRoleSelect").value });
    document.getElementById("targetNickInput").value = "";
  });

  sub = ActionCable.createConsumer().subscriptions.create(
    { channel: "BoardChannel", board_id: BOARD_ID, nickname: USER, client_id: CLIENT_ID },
    {
      received(data) {
        if (String(data.sender_id) === String(CLIENT_ID)) return;
        if (data.type === "delta_event" && Number(data.page_id) === Number(currentPageId)) {
          applyRemoteDelta(data);
        } else if (data.type === "canvas_updated" && Number(data.page_id) === Number(currentPageId)) {
          applyFullRemoteCanvas(data.canvas_data, data.version);
        } else if (data.type === "pages_updated") {
          pages = data.pages;
          loadPage(pages.some(p => Number(p.id) === Number(currentPageId)) ? currentPageId : pages[0]?.id);
        } else if (data.type === "permissions_updated") {
          accessLevel = data.access_level; permissions = data.permissions; refreshUI();
        } else if (data.type === "cursor_moved" && Number(data.page_id) === Number(currentPageId)) {
          let el = document.getElementById("cur-" + data.sender_id);
          if (!el) {
            el = document.createElement("div"); el.id = "cur-" + data.sender_id; el.className = "remote-cursor";
            el.innerHTML = "<i class=\"bi bi-cursor-fill text-primary\"></i><span class=\"badge bg-primary\">" + data.nickname + "</span>";
            document.getElementById("cursorsLayer").appendChild(el);
          }
          el.style.transform = "translate(" + data.x + "px, " + data.y + "px)";
        }
      }
    }
  );

  setInterval(() => {
    if (isPointerDown || isSavingNow) return;
    fetch("/boards/" + BOARD_ID + "/state?page_id=" + currentPageId)
      .then(r => r.json())
      .then(state => {
        if (state && state.version && Number(state.version) > lastKnownVersion + 0.0001) {
          applyFullRemoteCanvas(state.canvas_data, state.version);
        }
      })
      .catch(() => {});
  }, 450);

  loadPage(currentPageId);
  setTool("pen");
})();
