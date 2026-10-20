try {
  var theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark")
    document.documentElement.dataset.theme = theme;
} catch {
  /* Storage may be disabled by the browser. */
}
