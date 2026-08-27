(() => {
  const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
  const accessToken = params.get("access_token");
  if (!accessToken) { document.body.textContent = "Secure sign-in could not be completed."; return; }
  fetch("/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ access_token: accessToken }) })
    .then(response => { if (!response.ok) throw new Error("session exchange failed"); location.replace("/"); })
    .catch(() => { document.body.textContent = "Secure sign-in could not be completed."; });
})();
