// Start both applications without installing an additional process manager.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = path.join(root, ".venv", "bin", "python");
if (!existsSync(python) || !existsSync(path.join(root, "backend", ".env"))) {
  console.error("Set up .venv and backend/.env before running npm run dev:all.");
  process.exit(1);
}

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}

function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  // If either server stops, stop the other so no server is left behind.
  child.on("exit", (code) => stop(code ?? 1));
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start(python, ["-m", "uvicorn", "main:app", "--reload", "--port", "8000"], path.join(root, "backend"));
start(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3000"], root);
