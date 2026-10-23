import { chromium } from "playwright-core";

const defaultChromePath = process.platform === "win32"
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH ?? defaultChromePath,
  args: ["--use-angle=swiftshader", "--renderer-process-limit=1", "--disable-background-networking"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
const failures = [];

const readState = () => page.locator("#scene").evaluate((canvas) => ({
  viewMode: canvas.dataset.cameraViewMode ?? "",
  elapsed: canvas.dataset.simulationElapsed ?? "",
  network: canvas.dataset.networkObserverMode ?? "",
}));
const readFocus = () => page.evaluate(() => {
  const element = document.activeElement;
  return {
    tag: element ? element.tagName : "",
    id: element instanceof HTMLInputElement ? element.id : "",
    value: element instanceof HTMLInputElement ? element.value : "",
    type: element instanceof HTMLInputElement ? element.type : "",
    contentEditable: element instanceof HTMLElement ? element.isContentEditable : false,
  };
});

try {
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:5173/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await page.locator("#scene").waitFor({ state: "visible", timeout: 10_000 });
  await page.evaluate(() => { window.__cwiKeyboardFocusProbe = "alive"; });
  await page.locator("#sbCount").waitFor({ state: "visible" });
  await page.waitForFunction(() => Boolean(document.querySelector("#scene")?.dataset.cameraViewMode));

  // The setup panel only hides on START, so this pass runs the player's very
  // first interaction: typing counts and coordinates into the number fields.
  const initial = await readState();
  if (!initial.viewMode) failures.push("cameraViewMode dataset is missing");

  // A digit must still switch the camera when nothing is being typed into.
  await page.keyboard.press("9");
  await page.waitForFunction(() => document.querySelector("#scene")?.dataset.cameraViewMode === "9");
  const unfocused = await readState();
  if (unfocused.viewMode !== "9")
    failures.push(`unfocused 9 did not switch the view: ${initial.viewMode} -> ${unfocused.viewMode}`);

  await page.locator("#sbCount").click();
  const focused = await readFocus();
  if (focused.tag !== "INPUT" || focused.id !== "sbCount" || focused.type !== "number" || focused.contentEditable)
    failures.push(`#sbCount did not take typing focus: ${JSON.stringify(focused)}`);

  // Typing a digit into the field must not hijack the camera.
  await page.keyboard.press("1");
  await page.waitForTimeout(250);
  const typed = await readState();
  if (typed.viewMode !== "9")
    failures.push(`typing 1 into #sbCount hijacked the view: 9 -> ${typed.viewMode}`);

  // The same keystroke has to land in the field instead.
  const field = await readFocus();
  if (field.value === focused.value)
    failures.push(`typing 1 never reached #sbCount (value stayed "${focused.value}")`);

  // Letters must not reload the mission while a field owns the caret.
  await page.keyboard.press("r");
  await page.keyboard.press("n");
  await page.keyboard.press("Shift+n");
  await page.waitForTimeout(500);
  if ((await readState()).network !== initial.network) failures.push("typing n changed the network view");
  const probe = await page.evaluate(() => window.__cwiKeyboardFocusProbe ?? "gone");
  if (probe !== "alive") failures.push("pressing r inside #sbCount reloaded the page");

  await page.locator("#sbCount").evaluate((element) => element.blur());
  await page.keyboard.press("2");
  await page.waitForFunction(() => document.querySelector("#scene")?.dataset.cameraViewMode === "2");
  const restored = await readState();
  if (restored.viewMode !== "2")
    failures.push(`hotkey stayed blocked after leaving the field: ${restored.viewMode}`);

  console.log(JSON.stringify({ initial, unfocused, focused, field, typed, probe, restored, failures, errors }, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
