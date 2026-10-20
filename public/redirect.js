try {
  var supported = [
    "en",
    "zh-CN",
    "es",
    "ar",
    "fr",
    "pt",
    "ru",
    "hi",
    "ja",
    "ko",
    "de",
    "vi",
  ];
  var saved = localStorage.getItem("locale");
  // Walk the whole browser preference list, not only the first language.
  var preferred = (saved ? [saved] : []).concat(
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"],
  );
  var match;
  for (var i = 0; i < preferred.length && !match; i++) {
    var wanted = preferred[i].toLowerCase();
    match =
      supported.find(function (x) {
        return x.toLowerCase() === wanted;
      }) ||
      supported.find(function (x) {
        return x.split("-")[0].toLowerCase() === wanted.split("-")[0];
      });
  }
  match = match || "en";
  // Keep ?shared=1 from the share target.
  location.replace("/" + match + "/" + location.search);
} catch {
  location.replace("/en/");
}
