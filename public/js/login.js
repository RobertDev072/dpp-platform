document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById("error");
  errorEl.classList.add("hidden");

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const user = await apiRequest("POST", "/api/auth/login", { email, password });
    window.location.href = user.role === "system_owner" ? "/admin/index.html" : "/company/index.html";
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  }
});
