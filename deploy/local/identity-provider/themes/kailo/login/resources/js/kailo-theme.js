// Kailo tokens select dark values with <html data-kailo-theme="dark">; follow the same
// system preference the parent theme uses for its own dark class (DD-164(8)).
(function () {
  var query = window.matchMedia("(prefers-color-scheme: dark)");
  function apply(dark) {
    if (dark) document.documentElement.setAttribute("data-kailo-theme", "dark");
    else document.documentElement.removeAttribute("data-kailo-theme");
  }
  apply(query.matches);
  query.addEventListener("change", function (event) { apply(event.matches); });
})();
