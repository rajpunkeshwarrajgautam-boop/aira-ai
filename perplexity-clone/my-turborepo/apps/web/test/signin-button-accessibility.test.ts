import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("SIGNIN BUTTON DEFECT: UserMenu sign in button adheres to Oatmeal & Ink 2.1 persistent high contrast", () => {
  const userMenuPath = path.resolve(__dirname, "../components/UserMenu.tsx");
  const content = fs.readFileSync(userMenuPath, "utf-8");

  // Must not have the legacy disappearing text class
  assert.ok(
    !content.includes("text-[#f5f4ef]"),
    "UserMenu must not contain legacy cream text class text-[#f5f4ef]"
  );
  assert.ok(
    !content.includes("bg-[rgba(212,175,55,0.08)]"),
    "UserMenu must not contain faint legacy gold background"
  );

  // Must contain authoritative aira-topbar-signin class
  assert.ok(
    content.includes("aira-topbar-signin"),
    "UserMenu must apply authoritative aira-topbar-signin class"
  );

  // Must explicitly declare high-contrast white text on Royal Iris
  assert.ok(
    content.includes("bg-[#3A0CA3]") && content.includes("text-white"),
    "UserMenu must declare solid Royal Iris (#3A0CA3) with crisp white text"
  );

  // Must have accessible hover state
  assert.ok(
    content.includes("hover:bg-[#2D0A82]"),
    "UserMenu must declare darker hover background hover:bg-[#2D0A82]"
  );

  // Must have visible keyboard focus ring
  assert.ok(
    content.includes("focus-visible:ring"),
    "UserMenu must have visible focus ring for keyboard accessibility"
  );
});

test("SIGNIN BUTTON CSS: aira-visual-redesign.css governs .aira-topbar-signin contrast and states", () => {
  const cssPath = path.resolve(__dirname, "../app/aira-visual-redesign.css");
  const css = fs.readFileSync(cssPath, "utf-8");

  assert.ok(
    css.includes(".aira-topbar-signin"),
    "aira-visual-redesign.css must define .aira-topbar-signin"
  );
  assert.ok(
    css.includes("background: #3A0CA3") || css.includes("background: var(--aira-accent"),
    "Default background must be Royal Iris"
  );
  assert.ok(
    css.includes("color: #FFFFFF !important"),
    "Text color must be persistently white"
  );
  assert.ok(
    css.includes(".aira-topbar-signin:hover"),
    "Hover state must be defined"
  );
  assert.ok(
    css.includes(".aira-topbar-signin:focus-visible"),
    "Focus-visible state must be defined"
  );
});

test("OAUTH BUTTONS: visme-auth.css defines accessible states for .aira-auth-provider", () => {
  const authCssPath = path.resolve(__dirname, "../app/signin/visme-auth.css");
  const authCss = fs.readFileSync(authCssPath, "utf-8");

  assert.ok(
    authCss.includes(".aira-auth-provider"),
    "visme-auth.css must define .aira-auth-provider"
  );
  assert.ok(
    authCss.includes(".aira-auth-provider:hover:not(:disabled)"),
    "Hover state must be defined for enabled providers"
  );
  assert.ok(
    authCss.includes(".aira-auth-provider:focus-visible"),
    "Focus-visible state must be defined for keyboard accessibility"
  );
  assert.ok(
    authCss.includes(".aira-auth-provider:disabled"),
    "Disabled state must be defined"
  );
});
