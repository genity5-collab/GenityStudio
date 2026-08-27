(() => {
  const $ = selector => document.querySelector(selector);
  const csrfToken = () => document.cookie.split("; ").find(row => row.startsWith("rs_csrf="))?.split("=")[1] || "";
  const deviceId = () => {
    const existing = sessionStorage.getItem("rs_device");
    if (existing) return existing;
    const next = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem("rs_device", next);
    return next;
  };
  const requestId = () => crypto.randomUUID().replaceAll("-", "");
  const show = (selector, visible) => { const element = $(selector); if (element) element.style.display = visible ? "" : "none"; };
  const status = (selector, message, kind = "") => { const element = $(selector); if (element) { element.className = `st ${kind}`; element.textContent = message; } };
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken(), "X-RetroStudio-Device": deviceId(), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.detail?.message || "Request could not be completed."), { code: body.detail?.code || `RS-HTTP-${response.status}` });
    return body;
  };
  const activate = tabId => {
    document.querySelectorAll(".tabs button").forEach(button => button.classList.toggle("active", button.id === tabId));
    document.querySelectorAll(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel${tabId.slice(3)}`));
  };
  function installTabs() {
    ["tabAi", "tabEnc", "tabSocial", "tabDash"].forEach(id => $(`#${id}`)?.addEventListener("click", () => activate(id)));
  }
  function renderSession() {
    show("#gate", false); show("#finishGate", false); show("#main", true);
    const welcome = $("#welcomeName"); if (welcome) welcome.textContent = "Hey!";
    activate("tabAi");
  }
  async function restoreSession() {
    try { await api("/api/session", { method: "GET", headers: {} }); renderSession(); }
    catch { show("#gate", true); show("#finishGate", false); show("#main", false); }
  }
  function installAuthentication() {
    $("#discordBtn")?.addEventListener("click", () => {
      const button = $("#discordBtn"); if (button) button.disabled = true;
      show("#authMain", false); show("#authLoading", true); location.assign("/auth/login/discord");
    });
    const passwordPanel = $("#pwAuthBox");
    if (passwordPanel) {
      passwordPanel.style.display = "none";
      if (passwordPanel.previousElementSibling) passwordPanel.previousElementSibling.style.display = "none";
    }
    $("#logoutBtn")?.addEventListener("click", async () => { try { await api("/auth/logout", { method: "POST", body: "{}" }); } finally { location.assign("/"); } });
  }
  function installEncoder() {
    $("#sampleBtn")?.addEventListener("click", () => { const input = $("#luaIn"); if (input) input.value = 'print("Hello from RetroStudio")'; });
    $("#clearLuaBtn")?.addEventListener("click", () => { if ($("#luaIn")) $("#luaIn").value = ""; if ($("#encOut")) $("#encOut").value = ""; status("#encSt", "Cleared."); });
    $("#encBtn")?.addEventListener("click", async () => {
      const input = $("#luaIn"); const button = $("#encBtn"); const source = input?.value || "";
      if (!source.trim()) { status("#encSt", "Enter Luau source first.", "err"); return; }
      if (button) button.disabled = true;
      status("#encSt", "Authorizing secure encoder…");
      try {
        const result = await api("/api/encoder/encode", { method: "POST", body: JSON.stringify({ source, request_id: requestId() }) });
        $("#encOut").value = result.output; status("#encSt", `Encoded ${result.stats.blocks} block${result.stats.blocks === 1 ? "" : "s"} securely.`, "ok");
        if ($("#statsBar")) $("#statsBar").textContent = `${result.stats.input_characters} input characters · ${result.stats.output_characters} output characters`;
      } catch (error) { status("#encSt", `${error.code || "RS-ENCODER"}: ${error.message}`, "err"); }
      finally { if (button) button.disabled = false; }
    });
    $("#copyBtn")?.addEventListener("click", async () => { const value = $("#encOut")?.value || ""; if (value) await navigator.clipboard.writeText(value); });
    $("#dlBtn")?.addEventListener("click", () => { const value = $("#encOut")?.value || ""; if (!value) return; const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(new Blob([value], { type: "text/plain" })); anchor.download = "retrostudio-output.lua"; anchor.click(); URL.revokeObjectURL(anchor.href); });
    $("#fileBtn")?.addEventListener("click", () => $("#fileInput")?.click());
    $("#fileInput")?.addEventListener("change", async event => { const file = event.target.files?.[0]; if (!file || file.size > 16_000) { status("#encSt", "Use a text file below 16 KB.", "err"); return; } const text = await file.text(); if ($("#luaIn")) $("#luaIn").value = text; });
  }
  function installSafeStubs() {
    $("#apiKey")?.setAttribute("readonly", "readonly");
    if ($("#apiKey")) $("#apiKey").placeholder = "Managed securely by server";
    $("#keyBtn")?.addEventListener("click", () => status("#aiSt", "Provider keys are stored only in secure server configuration.", "ok"));
    document.querySelectorAll("#modelStrip .model-pill").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll("#modelStrip .model-pill").forEach(item => item.classList.remove("active"));
      button.classList.add("active"); if ($("#prov")) $("#prov").value = button.dataset.provider;
    }));
    $("#aiSend")?.addEventListener("click", async () => {
      const prompt = $("#aiIn")?.value.trim() || ""; const provider = $("#prov")?.value || "free"; const button = $("#aiSend");
      if (!prompt) { status("#aiSt", "Enter a message first.", "err"); return; }
      if (button) button.disabled = true;
      status("#aiSt", "Sending authenticated server request…");
      try {
        const result = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ prompt, provider }) });
        const row = document.createElement("div"); row.className = "chat-row ai"; const bubble = document.createElement("div"); bubble.className = "chat-bubble bot"; bubble.textContent = result.content; row.append(bubble); $("#aiLog")?.append(row); $("#aiIn").value = ""; status("#aiSt", "Response received securely.", "ok");
      } catch (error) { status("#aiSt", `${error.code || "RS-AI"}: ${error.message}`, "err"); }
      finally { if (button) button.disabled = false; }
    });
    const unavailable = [
      "#searchUsersBtn", "#chatSendBtn", "#socialTabFriends", "#socialTabRequests", "#socialTabChat",
      "#changeNameBtn", "#changeDescBtn", "#changePicBtn", "#changeKnownAsBtn", "#delBtn", "#confirmDelBtn",
      "#adminBanBtn", "#adminUnbanBtn", "#adminWarnBtn", "#adminDeleteBtn", "#adminBroadcastBtn",
      "#ownerReleasePublish", "#ownerReleaseClear", "#ownerRuntimeSave", "#ownerRuntimeReload"
    ];
    unavailable.forEach(selector => {
      const control = $(selector);
      if (!control) return;
      control.setAttribute("aria-disabled", "true");
      control.setAttribute("data-secure-disabled", "true");
      control.title = "This control is unavailable until its server-authoritative contract is enabled.";
      control.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); status("#memberModerationBanner", "This action remains disabled until its secure server workflow is enabled.", "warn"); }, true);
    });
  }
  function init() { installTabs(); installAuthentication(); installEncoder(); installSafeStubs(); restoreSession(); }
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
