"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function listJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScript(full) :
      (entry.name.endsWith(".js") ? [full] : []);
  });
}

for (const root of ["src", "scripts", "tests"]) {
  for (const file of listJavaScript(path.resolve(__dirname, "..", root))) {
    const result = spawnSync(process.execPath, ["--check", file], {
      stdio: "inherit"
    });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

console.log("All JavaScript syntax checks passed.");
