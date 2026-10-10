"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "instrumentation";
exports.ids = ["instrumentation"];
exports.modules = {

/***/ "(instrument)/./src/instrumentation.ts":
/*!********************************!*\
  !*** ./src/instrumentation.ts ***!
  \********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   register: () => (/* binding */ register)\n/* harmony export */ });\n/** Server startup: report email misconfiguration once, without secrets, without crashing the app. */ async function register() {\n    if (false) {}\n    const { emailConfig } = await Promise.all(/*! import() */[__webpack_require__.e(\"vendor-chunks/mustache\"), __webpack_require__.e(\"_instrument_src_lib_email_index_ts\")]).then(__webpack_require__.bind(__webpack_require__, /*! ./lib/email */ \"(instrument)/./src/lib/email/index.ts\"));\n    for (const p of emailConfig().problems)console.error(`[email] config: ${p}`);\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vc3JjL2luc3RydW1lbnRhdGlvbi50cyIsIm1hcHBpbmdzIjoiOzs7O0FBQUEsbUdBQW1HLEdBQzVGLGVBQWVBO0lBQ3BCLElBQUlDLEtBQXFDLEVBQUUsRUFBTztJQUNsRCxNQUFNLEVBQUVHLFdBQVcsRUFBRSxHQUFHLE1BQU0sMFBBQXFCO0lBQ25ELEtBQUssTUFBTUMsS0FBS0QsY0FBY0UsUUFBUSxDQUFFQyxRQUFRQyxLQUFLLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRUgsR0FBRztBQUM5RSIsInNvdXJjZXMiOlsiL3dvcmtzcGFjZS9kb29kbGUvc3JjL2luc3RydW1lbnRhdGlvbi50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKiogU2VydmVyIHN0YXJ0dXA6IHJlcG9ydCBlbWFpbCBtaXNjb25maWd1cmF0aW9uIG9uY2UsIHdpdGhvdXQgc2VjcmV0cywgd2l0aG91dCBjcmFzaGluZyB0aGUgYXBwLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZ2lzdGVyKCkge1xuICBpZiAocHJvY2Vzcy5lbnYuTkVYVF9SVU5USU1FICE9PSAnbm9kZWpzJykgcmV0dXJuO1xuICBjb25zdCB7IGVtYWlsQ29uZmlnIH0gPSBhd2FpdCBpbXBvcnQoJy4vbGliL2VtYWlsJyk7XG4gIGZvciAoY29uc3QgcCBvZiBlbWFpbENvbmZpZygpLnByb2JsZW1zKSBjb25zb2xlLmVycm9yKGBbZW1haWxdIGNvbmZpZzogJHtwfWApO1xufVxuIl0sIm5hbWVzIjpbInJlZ2lzdGVyIiwicHJvY2VzcyIsImVudiIsIk5FWFRfUlVOVElNRSIsImVtYWlsQ29uZmlnIiwicCIsInByb2JsZW1zIiwiY29uc29sZSIsImVycm9yIl0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(instrument)/./src/instrumentation.ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("./webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("(instrument)/./src/instrumentation.ts"));
module.exports = __webpack_exports__;

})();