import { expect, test, type Locator, type Page } from "playwright/test";

const desktopName =
  "Paseo desktop app with coding agents, a conversation, and a code diff open side by side";

async function openAgentLanding(page: Page) {
  await page.setViewportSize({ width: 1512, height: 930 });
  await page.goto("/claude-code");
  await expect(page.getByRole("button", { name: "Build", exact: true })).toBeVisible();
}

async function viewPhones(page: Page) {
  await page.getByRole("img", { name: "Paseo agent chat", exact: true }).scrollIntoViewIfNeeded();
}

async function expectScreenContentInsidePhone(page: Page, name: string, time: string) {
  const phone = page.getByRole("img", { name, exact: true });
  const clock = phone.getByText(time, { exact: true });
  await expect(clock).toBeVisible();
  await expect(async () => {
    const frame = await phone.boundingBox();
    const content = await clock.boundingBox();
    expect(frame).not.toBeNull();
    expect(content).not.toBeNull();
    if (!frame || !content) throw new Error("Phone screen is not rendered");
    expect(content.x).toBeGreaterThanOrEqual(frame.x);
    expect(content.y).toBeGreaterThanOrEqual(frame.y);
    expect(content.x + content.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(content.y + content.height).toBeLessThanOrEqual(frame.y + frame.height);
  }).toPass({ timeout: 5000 });
}

async function cornerProportion(mockup: Locator) {
  return mockup.evaluate((element) => {
    const radius = getComputedStyle(element).borderTopLeftRadius.split(" ")[0];
    if (radius.endsWith("%")) return Number.parseFloat(radius) / 100;
    return Number.parseFloat(radius) / element.getBoundingClientRect().width;
  });
}

async function resizeToPhone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("img", { name: desktopName, exact: true }).scrollIntoViewIfNeeded();
}

test("the three phone mockups show their screen content", async ({ page }) => {
  await openAgentLanding(page);
  await viewPhones(page);
  await expectScreenContentInsidePhone(page, "Paseo workspace drawer", "18:54");
  await expectScreenContentInsidePhone(page, "Paseo agent chat", "18:53");
  await expectScreenContentInsidePhone(page, "Paseo diff view", "18:55");
});

test("desktop mockup corners shrink in proportion on a phone", async ({ page }) => {
  await openAgentLanding(page);
  const mockup = page.getByRole("img", { name: desktopName, exact: true });
  const desktopCorner = await cornerProportion(mockup);
  expect(desktopCorner).toBeGreaterThan(0);
  await resizeToPhone(page);
  await expect.poll(() => cornerProportion(mockup)).toBeCloseTo(desktopCorner, 3);
});

test("Dissect shows the supplied product screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".dissect-site")).toHaveAttribute("data-ready", "true");
  const image = page.locator(".ds-screenshot-frame img");
  await expect(image).toHaveAttribute("src", "/dissect-workspace.png");
  await expect(image).toHaveJSProperty("naturalWidth", 1915);
  await page.getByRole("button", { name: "Code explanations", exact: true }).click();
  await expect(image).toHaveAttribute("src", "/dissect-code.png");
  await expect(image).toHaveJSProperty("naturalWidth", 709);
  await page.getByRole("button", { name: "Change analysis", exact: true }).click();
  await expect(image).toHaveAttribute("src", "/dissect-changes.png");
  await expect(image).toHaveJSProperty("naturalWidth", 706);
  await expect(
    page.getByRole("link", { name: "Open change analysis screenshot at full size" }),
  ).toHaveAttribute("href", "/dissect-changes.png");
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expect(image).toHaveAttribute("src", "/dissect-workspace.png");
  const featureArt = page.locator(".ds-feature-art").first();
  await expect(featureArt).toBeVisible();
  const featureBounds = await featureArt.boundingBox();
  expect(featureBounds?.height).toBeGreaterThanOrEqual(500);
  await expect(page.getByRole("heading", { name: "Dissect evolves with you." })).toBeVisible();
  await expect(page.getByText("Powered by SpacetimeDB", { exact: true })).toBeVisible();
  await expect(page.locator(".ds-inline-image")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("style", /opacity: 1/);
  await page.screenshot({ path: "../../.tmp/dissect-real-screenshots.png", fullPage: true });
});

test("Dissect navigation and product controls work on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".dissect-site")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "The product", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: /Go beneath the surface/ }).click();
  await expect(page.getByRole("button", { name: /Go beneath the surface/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.locator("blockquote")).toContainText("What did my agent actually change?");
  await page.getByRole("button", { name: "Previous question" }).click();
  await expect(page.locator("blockquote")).toContainText("Where does a request go");
  await page.getByRole("link", { name: "Take a closer look" }).click();
  await page.getByRole("button", { name: "Code explanations", exact: true }).click();
  await expect(page.locator(".ds-screenshot-frame img")).toHaveJSProperty("naturalWidth", 709);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "../../.tmp/dissect-mobile.png", fullPage: true });
});
