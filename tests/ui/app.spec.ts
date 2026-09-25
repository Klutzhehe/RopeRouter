import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { crossingFixture } from "../fixtures/crossing";
import { validate } from "../../src/core/geometry";
import { Solver } from "../../src/core/solver";
test("simulation controls, layers, generation, save/load, and narrow layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run simulation" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(page.getByTestId("tick")).toHaveText("Tick 00001");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("tick")).not.toHaveText("Tick 00001", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(page.getByTestId("tick")).toHaveText("Tick 00000");
  await page
    .getByRole("button", { name: "Toggle layer 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Toggle layer 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Random seed", { exact: true }).fill("99");
  await page.getByLabel("Components", { exact: true }).selectOption("8");
  await page.getByRole("button", { name: "Generate board" }).click();
  await expect(page.locator("footer")).toContainText("8 components");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const saved = await download;
  const path = await saved.path();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(page.locator(".toast")).toContainText("Project loaded");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.locator(".toast")).toContainText("Could not load");
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.locator(".violation-list button").first().click();
  await expect(page.getByRole("tooltip")).toHaveClass(/visible/);
  await expect(page.getByRole("tooltip")).toContainText("Unresolved");
  await expect(page.getByRole("tooltip").locator("p")).not.toBeEmpty();
  await page.screenshot({ path: "test-results/violation-bubble.png" });
  await expect(page.getByRole("tooltip")).not.toHaveClass(/visible/, {
    timeout: 7000,
  });
  await page.getByRole("button", { name: "Fit board" }).click();
  await page.screenshot({ path: "test-results/desktop.png" });
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.waitForTimeout(2500);
  const pauseBtn = page.getByRole("button", { name: "Pause", exact: true });
  if (await pauseBtn.isVisible()) {
    await pauseBtn.click();
  }
  await page.screenshot({ path: "test-results/simulation-snapped.png" });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(page.locator("aside")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/narrow.png" });
  expect(errors).toEqual([]);
});

test("16 components 2 layers completes with validated saved geometry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Random seed", { exact: true }).fill("42017");
  await page.getByLabel("Components", { exact: true }).selectOption("16");
  await page.getByLabel("Initial layers", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Generate board" }).click();
  await expect(page.locator("footer")).toContainText("16 components");
  await page.screenshot({
    path: "test-results/16-components-tick0-dangling.png",
  });
  await page.getByRole("button", { name: "Run simulation" }).click();
  test.setTimeout(120000);
  await expect(
    page.getByText("Validated solution", { exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await page.screenshot({ path: "test-results/16-components-2-layers.png" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export simulation" }).click();
  const snapshot = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(snapshot.project.tick).toBeGreaterThan(0);
  expect(snapshot.live.routes.length).toBe(snapshot.routes.length);
  expect(snapshot.reports.live.connected).toBe(snapshot.routes.length);
  expect(snapshot.runtime.stopReason).toBe("solved");
  expect(snapshot.reports.live.violations).toEqual([]);
  expect(validate(snapshot.project).violations).toEqual([]);
  const savedProject = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const project = JSON.parse(
    await readFile((await (await savedProject).path())!, "utf8"),
  );
  expect(validate(project).violations).toEqual([]);
  await expect(page.locator("aside")).toContainText(
    "Valid within prototype geometry rules",
  );
});

test("running snapshot exports real worker state and resumes deterministically after import", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const fixture = crossingFixture();
  fixture.settings.snaps = false;
  await page.locator("input[type=file]").setInputFiles({
    name: "crossing.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(
    page.getByRole("button", { name: "Run simulation" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByTestId("tick")).not.toHaveText("Tick 00000");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export simulation" }).click();
  const saved = await exported;
  const snapshot = JSON.parse(await readFile((await saved.path())!, "utf8"));
  expect(snapshot.runtime.running).toBe(true);
  expect(snapshot.project.tick).toBeGreaterThan(0);
  expect(snapshot.routes[0].nodes.length).toBeGreaterThan(2);
  expect(snapshot.reports.live.violations.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles((await saved.path())!);
  await expect(page.locator(".toast")).toContainText("Simulation loaded");
  await expect(page.getByTestId("tick")).toHaveText(
    `Tick ${String(snapshot.project.tick).padStart(5, "0")}`,
  );
  const expected = Solver.restore(snapshot);
  expected.step();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(page.getByTestId("tick")).toHaveText(
    `Tick ${String(snapshot.project.tick + 1).padStart(5, "0")}`,
  );
  const replayed = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export simulation" }).click();
  const actual = JSON.parse(
    await readFile((await (await replayed).path())!, "utf8"),
  );
  expect(actual.routes).toEqual(expected.snapshot().routes);
  expect(actual.supervisor).toEqual(expected.snapshot().supervisor);
  expect(actual.project).toEqual(expected.snapshot().project);
  expect(errors).toEqual([]);
});

test("generates, steps, and saves all 40 components from the selector", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  const selector = page.getByLabel("Components", { exact: true });
  await expect(selector.locator("option")).toHaveText([
    "4",
    "8",
    "12",
    "16",
    "20",
    "24",
    "32",
    "40",
    "64",
    "100",
    "200",
  ]);
  await selector.selectOption("40");
  await page.getByRole("button", { name: "Generate board" }).click();
  await expect(page.locator("footer")).toContainText("40 components");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(page.getByTestId("tick")).toHaveText("Tick 00001", {
    timeout: 20000,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const file = await (await download).path();
  const project = JSON.parse(await readFile(file!, "utf8"));
  expect(project.components).toHaveLength(40);
  expect(project.routes).toHaveLength(40);
  expect(project.height).toBe(185000);
  await page.locator("input[type=file]").setInputFiles(file!);
  await expect(page.locator(".toast")).toContainText("Project loaded");
  await expect(page.locator("footer")).toContainText("40 components");
});

test("pause and export preserve an in-progress whole-board sweep", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByLabel("Components", { exact: true }).selectOption("24");
  await page.getByLabel("Initial layers", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Generate board" }).click();
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.locator(".canvas-heading")).toContainText("Board sweep", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export simulation" }).click();
  const file = await (await download).path();
  const saved = JSON.parse(await readFile(file!, "utf8"));
  expect(saved.sweep.phase).toBe("searching");
  expect(saved.runtime.running).toBe(false);
  const replay = Solver.restore(saved);
  replay.step();
  await page.locator("input[type=file]").setInputFiles(file!);
  await expect(page.locator(".toast")).toContainText("Simulation loaded");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  const nextDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export simulation" }).click();
  const actual = JSON.parse(
    await readFile((await (await nextDownload).path())!, "utf8"),
  );
  expect(actual.sweep).toEqual(replay.snapshot().sweep);
  expect(actual.routes).toEqual(replay.snapshot().routes);
});
