// The prebuilt ESM bundle has the same API as the package, as its default export.
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  import Tesseract from "tesseract.js";
  export default Tesseract;
}
