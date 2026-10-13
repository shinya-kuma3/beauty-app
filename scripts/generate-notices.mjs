import { readFile, readdir, writeFile } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const parts = [
  "THIRD-PARTY SOFTWARE NOTICES\nGenerated from installed production dependencies. Individual licenses apply to their respective components.\n",
];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!path.startsWith("node_modules/") || entry.dev) continue;
  let pkg, files;
  try {
    pkg = JSON.parse(await readFile(path + "/package.json", "utf8"));
    files = await readdir(path);
  } catch {
    continue;
  }
  const licenses = files.filter((name) =>
    /^(license|licence|copying|notice)([._-].*)?$/i.test(name),
  );
  let text = "";
  for (const name of licenses) {
    try {
      text += "\n" + name + "\n" + (await readFile(path + "/" + name, "utf8"));
    } catch {}
  }
  parts.push(
    "\n========================================\n" +
      pkg.name +
      " " +
      pkg.version +
      "\nLicense: " +
      JSON.stringify(pkg.license || entry.license || "See upstream package") +
      "\n" +
      (pkg.homepage || pkg.repository?.url || "") +
      "\n" +
      text,
  );
}
await writeFile("public/third-party-licenses.txt", parts.join("\n"));
console.log(
  "Generated notices for " +
    (parts.length - 1) +
    " installed production packages.",
);
