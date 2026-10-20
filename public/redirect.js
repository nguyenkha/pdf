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
    "de",
    "vi",
  ];
  var saved = localStorage.getItem("locale");
  var preferred = saved || navigator.language || "en";
  var match =
    supported.find(function (x) {
      return x.toLowerCase() === preferred.toLowerCase();
    }) ||
    supported.find(function (x) {
      return x.split("-")[0] === preferred.split("-")[0];
    }) ||
    "en";
  location.replace("/" + match + "/");
} catch {
  location.replace("/en/");
}
