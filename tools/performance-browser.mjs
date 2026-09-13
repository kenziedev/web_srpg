import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch, release } from "node:os";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

// Serve the existing production build separately; this script never builds or
// starts/stops a server. Use fresh browser contexts, not the user's saved game.
const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:4174/srpg/" },
    output: { type: "string", default: "artifacts/performance-browser.json" },
    runs: { type: "string", default: "5" },
  },
});
const count = Number(values.runs);
if (!Number.isInteger(count) || count < 5 || count > 20)
  throw new Error("--runs must be an integer between 5 and 20");
const rulesVersion = JSON.parse(
  readFileSync(
    resolve(root, "packages/content/data/two-crossings.json"),
    "utf8",
  ),
).rulesVersion;
const index = readFileSync(resolve(root, "apps/web/dist/index.html"), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const bundles = [
  ...index.matchAll(/(?:src|href)="(\/srpg\/assets\/[^"]+)"/g),
].map((match) => {
  const data = readFileSync(
    resolve(root, "apps/web/dist", match[1].slice("/srpg/".length)),
  );
  return { urlPath: match[1], bytes: data.length, sha256: hash(data) };
});
if (!bundles.some((bundle) => bundle.urlPath.endsWith(".js")))
  throw new Error(
    "Build the /srpg/ production bundle with pnpm build:srpg first",
  );

const conditions = {
  offline: false,
  latency: 100,
  downloadThroughput: 10_000_000 / 8,
  uploadThroughput: 10_000_000 / 8,
  connectionType: "ethernet",
};
const round = (value) => Math.round(value * 1000) / 1000;
function summary(samples, budgetMs) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    samples: sorted.length,
    medianMs: sorted.length ? round(median) : null,
    maxMs: sorted.length ? round(sorted.at(-1)) : null,
    budgetMs,
    passed: sorted.length === count && sorted.at(-1) <= budgetMs,
  };
}

async function savedState(page) {
  return page.evaluate(
    (key) =>
      new Promise((resolveSave, reject) => {
        const open = indexedDB.open("orden-battle", 1);
        open.onerror = () =>
          reject(new Error("Cannot open the battle database"));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("saves", "readonly");
          const request = transaction.objectStore("saves").get(key);
          transaction.oncomplete = () => {
            database.close();
            const save = request.result;
            if (!save) {
              reject(new Error("The confirmed wait was not saved"));
              return;
            }
            resolveSave({
              revision: save.revision,
              checksum: save.checksum,
              lastCommandId: save.lastCommandId,
              commandCount: save.commands.length,
              action: save.commands.at(-1)?.action?.type,
              acted: save.battle.units.find((unit) => unit.id === "A1")?.acted,
            });
          };
          transaction.onabort = () => {
            database.close();
            reject(new Error("Cannot read the confirmed save"));
          };
        };
      }),
    `${rulesVersion}:practice:latest`,
  );
}

const browser = await chromium.launch({ headless: true });
const samples = [];
try {
  for (let run = 1; run <= count; run++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.clearBrowserCache");
    // A fresh empty cache is allowed to fill so the later reload is a normal,
    // warm reload. Disabling the cache here would also prevent that warm-up.
    await client.send("Network.setCacheDisabled", { cacheDisabled: false });
    await client.send("Network.emulateNetworkConditions", conditions);
    let stage = "cold";
    const responses = [];
    const servedFromCache = new Set();
    const transferred = new Map();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    client.on("Network.requestServedFromCache", ({ requestId }) => {
      if (stage === "cold") servedFromCache.add(requestId);
    });
    client.on("Network.responseReceived", ({ requestId, response, type }) => {
      if (
        stage === "cold" &&
        ["Document", "Script", "Stylesheet"].includes(type)
      )
        responses.push({
          requestId,
          type,
          url: response.url,
          status: response.status,
          fromDiskCache: !!response.fromDiskCache,
          fromServiceWorker: !!response.fromServiceWorker,
          contentEncoding:
            Object.entries(response.headers).find(
              ([name]) => name.toLowerCase() === "content-encoding",
            )?.[1] ?? "identity",
        });
    });
    client.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
      if (stage === "cold") transferred.set(requestId, encodedDataLength);
    });
    const sample = { run };
    try {
      const started = performance.now();
      const response = await page.goto(values.url, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
      const roster = page.getByRole("button", {
        name: "부대 목록",
        exact: true,
      });
      await expect(roster).toBeEnabled();
      await roster.click();
      await page
        .getByRole("button", { name: "카이엘 선택", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "카이엘", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "대기", exact: true }),
      ).toBeEnabled();
      sample.coldSelectableMs = round(performance.now() - started);
      stage = "between";
      sample.coldResources = responses.map(({ requestId, ...resource }) => ({
        ...resource,
        servedFromCache: servedFromCache.has(requestId),
        transferredBytes: transferred.get(requestId) ?? 0,
      }));
      sample.coldTransferredBytes = sample.coldResources.reduce(
        (sum, resource) => sum + resource.transferredBytes,
        0,
      );
      expect(
        sample.coldResources.every(
          (resource) =>
            !resource.fromDiskCache &&
            !resource.fromServiceWorker &&
            !resource.servedFromCache,
        ),
      ).toBe(true);
      expect(
        sample.coldResources.filter((resource) => resource.type === "Script")
          .length,
      ).toBeGreaterThan(0);
      await page.getByRole("button", { name: "대기", exact: true }).click();
      await page.getByRole("button", { name: "행동 확정" }).click();
      await expect(page.getByTestId("save-status")).toContainText(
        "자동 저장 완료",
      );
      await expect(page.getByTestId("acted")).toHaveText("행동 완료");
      const before = await savedState(page);
      expect(before).toMatchObject({
        revision: 1,
        commandCount: 1,
        action: "wait",
        acted: true,
      });
      stage = "reload";
      const reloading = performance.now();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
      await expect(page.getByTestId("save-status")).toContainText(
        "저장 복구 완료",
      );
      await expect(page.getByTestId("acted")).toHaveText("행동 완료");
      await expect(roster).toBeEnabled();
      sample.reloadRestoredMs = round(performance.now() - reloading);
      expect(await savedState(page)).toEqual(before);
      expect(errors).toEqual([]);
      sample.savedRevision = before.revision;
      sample.restoredWithoutDuplicateCommand = true;
      sample.pageErrors = errors;
    } catch (error) {
      sample.error = error.message;
    } finally {
      samples.push(sample);
      await context.close();
    }
    console.log(
      JSON.stringify({
        run,
        coldSelectableMs: sample.coldSelectableMs,
        reloadRestoredMs: sample.reloadRestoredMs,
        error: sample.error,
      }),
    );
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    browser: browser.version(),
    headless: true,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
    viewport: { width: 1280, height: 720 },
  },
  source: {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    dirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0,
    rulesVersion,
    productionIndexSha256: hash(index),
    bundles,
  },
  method: {
    url: values.url,
    runs: count,
    network: {
      downloadMbps: 10,
      uploadMbps: 10,
      latencyMs: 100,
      implementation: "Chromium CDP Network.emulateNetworkConditions",
    },
    cold: "Fresh isolated context and cleared HTTP cache per sample; measured navigation through ready canvas and actual Kaiel selection with enabled wait command. All document/script/style cache flags verified false.",
    reload:
      "Same context, normal warm-cache reload after a confirmed and saved wait; measured through ready canvas, restored save, spent actor and selectable roster; stored revision and checksum then verified unchanged.",
    exclusions: [
      "low-spec device qualification",
      "FPS and animation benchmarks",
      "remote hosting and TLS latency",
      "long battle save restore",
      "other browser engines",
    ],
  },
  coldStartup: summary(
    samples.flatMap((sample) =>
      sample.coldSelectableMs === undefined ? [] : [sample.coldSelectableMs],
    ),
    5000,
  ),
  reloadRestore: summary(
    samples.flatMap((sample) =>
      sample.reloadRestoredMs === undefined ? [] : [sample.reloadRestoredMs],
    ),
    2000,
  ),
  samples,
};
const output = resolve(root, values.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      coldStartup: report.coldStartup,
      reloadRestore: report.reloadRestore,
    },
    null,
    2,
  ),
);
if (
  samples.some((sample) => sample.error) ||
  !report.coldStartup.passed ||
  !report.reloadRestore.passed
)
  process.exitCode = 1;
