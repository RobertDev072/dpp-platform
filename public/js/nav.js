let currentUser = null;

async function initNav() {
  currentUser = await api.get("/api/auth/me");

  const whoami = document.getElementById("whoami");
  if (whoami) {
    whoami.textContent = `${currentUser.email} (${currentUser.role})`;
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api.post("/api/auth/logout");
      window.location.href = "/login.html";
    });
  }

  return currentUser;
}
