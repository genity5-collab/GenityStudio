(() => {
  const assetTypes = ["Image", "Model", "Decal", "Mesh", "Audio"];

  function element(tag, properties = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(properties).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "htmlFor") node.htmlFor = value;
      else node.setAttribute(key, value);
    });
    children.forEach(child => node.append(child));
    return node;
  }

  function addAssetCard(asset, position) {
    const image = element("img", { src: asset.thumbnailUrl, alt: `Preview of ${asset.name}`, loading: position > 2 ? "lazy" : "eager" });
    image.addEventListener("error", () => { image.classList.add("retrox-image-error"); image.alt = "Asset preview unavailable"; });
    const preview = element("div", { className: "retrox-preview" }, [
      image,
      element("span", { className: "retrox-seq", text: `#${String(position).padStart(2, "0")}` }),
      element("span", { className: "retrox-type", text: asset.assetType }),
    ]);
    const copy = element("button", { type: "button", className: "retrox-copy", "aria-label": `Copy asset ID ${asset.id}`, text: "▣" });
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(asset.id); copy.textContent = "✓"; setTimeout(() => { copy.textContent = "▣"; }, 1200); }
      catch { copy.textContent = "!"; }
    });
    const details = element("div", { className: "retrox-details" }, [
      element("p", { className: "retrox-name", title: asset.name, text: asset.name }),
      element("p", { className: "retrox-creator", text: `CREATOR // ${asset.creator}` }),
      element("div", { className: "retrox-id" }, [element("code", { text: `ASSET_ID: ${asset.id}` }), copy]),
    ]);
    return element("article", { className: "retrox-card" }, [preview, details]);
  }

  function init() {
    const tabs = document.querySelector(".tabs");
    const main = document.querySelector("#main");
    if (!tabs || !main || document.querySelector("#tabAssets")) return;

    const tab = element("button", { id: "tabAssets", type: "button", text: "🔎 Assets" });
    const panel = element("div", { id: "panelAssets", className: "panel" });
    const card = element("div", { className: "box retrox-box" });
    const heading = element("div", { className: "retrox-heading" }, [
      element("div", {}, [element("span", { className: "retrox-kicker", text: "RETROX // LIVE SEARCH" }), element("h3", { text: "Roblox assets" })]),
      element("p", { text: "Protected server lookup · 10 results per request" }),
    ]);
    const form = element("form", { className: "retrox-form" });
    const keywordLabel = element("label", { htmlFor: "retroxKeyword", text: "Asset keyword" });
    const keyword = element("input", { id: "retroxKeyword", type: "search", maxlength: "80", autocomplete: "off", placeholder: "Search models, images, decals…", required: "" });
    const typeLabel = element("label", { htmlFor: "retroxType", text: "Asset type" });
    const type = element("select", { id: "retroxType" });
    assetTypes.forEach(value => type.append(element("option", { value, text: value === "Image" ? "Images" : `${value}s` })));
    type.value = "Model";
    const submit = element("button", { type: "submit", className: "btn retrox-submit", text: "Transmit search" });
    const status = element("div", { className: "st retrox-status", role: "status", "aria-live": "polite", text: "Terminal standing by." });
    const output = element("div", { className: "retrox-output" });
    form.append(keywordLabel, keyword, typeLabel, type, submit);
    card.append(heading, form, status, output);
    panel.append(card);
    tabs.append(tab);
    main.append(panel);

    function activate() {
      document.querySelectorAll(".panel").forEach(item => item.classList.remove("active"));
      document.querySelectorAll(".tabs button").forEach(item => item.classList.remove("active"));
      panel.classList.add("active");
      tab.classList.add("active");
      keyword.focus();
    }
    tab.addEventListener("click", activate);
    ["#tabAi", "#tabEnc", "#tabSocial", "#tabDash"].forEach(selector => {
      document.querySelector(selector)?.addEventListener("click", () => { panel.classList.remove("active"); tab.classList.remove("active"); });
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const term = keyword.value.trim();
      if (!term) { status.className = "st err retrox-status"; status.textContent = "Enter an asset keyword."; return; }
      submit.disabled = true;
      status.className = "st retrox-status";
      status.textContent = "Scanning protected Creator Store uplink…";
      output.replaceChildren();
      try {
        const response = await fetch("/api/retrox/assets/search", {
          method: "POST",
          headers: { "content-type": "application/json", "X-CSRF-Token": document.cookie.split("; ").find(row => row.startsWith("rs_csrf="))?.split("=")[1] || "", "X-RetroStudio-Device": sessionStorage.getItem("rs_device") || crypto.randomUUID().replaceAll("-", "") },
          credentials: "same-origin",
          body: JSON.stringify({ keyword: term, asset_type: type.value }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload.detail || {};
          throw Object.assign(new Error(detail.message || "Search transmission failed."), { code: detail.code || `RX-LINK-${response.status}` });
        }
        if (payload.status === "empty") {
          status.className = "st warn retrox-status";
          status.textContent = "No signal detected. Try another keyword or asset type.";
          return;
        }
        if (!Array.isArray(payload.results) || payload.results.length !== 10) throw Object.assign(new Error("Search returned an incomplete asset packet."), { code: "RX-PACKET-010" });
        status.className = "st ok retrox-status";
        status.textContent = "10 assets synchronized.";
        const grid = element("div", { className: "retrox-grid", "aria-label": "Ten Roblox search results" });
        payload.results.forEach((asset, index) => grid.append(addAssetCard(asset, index + 1)));
        output.append(grid);
      } catch (error) {
        status.className = "st err retrox-status";
        status.textContent = `${error.code || "RX-LINK-503"}: ${error.message}`;
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
