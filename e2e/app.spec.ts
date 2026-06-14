import { test, expect, type Page } from '@playwright/test';

const FAST_SCENARIO =
  '/?seed=aldermarch&worldScale=24&settlementPressure=24&defensePressure=35&prosperity=45&terrainRuggedness=35&waterPresence=35&monumentality=35';

async function openControls(page: Page): Promise<void> {
  const body = page.locator('#panel-body');
  if (!(await body.isVisible())) {
    await page.getByRole('button', { name: 'Controls' }).click();
  }
  await expect(body).toBeVisible();
}

async function openSummary(page: Page): Promise<void> {
  await openControls(page);
  const summary = page.locator('.summary');
  if ((await summary.getAttribute('open')) === null) {
    await page.getByText('Summary', { exact: true }).click();
  }
  await expect(summary).toHaveAttribute('open', '');
}

async function waitForGeneratedSeed(page: Page, seed: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const raw = await page.getByTestId('hamlet-debug-state').textContent();
        return raw ? JSON.parse(raw).world.seed : '';
      },
      { timeout: 45_000 },
    )
    .toBe(seed);
}

async function clickGenerate(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Generate' });
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

test.describe('Procedural Fantasy Hamlet SPA', () => {
  test('boots straight into a generated diorama (no setup gate)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');

    // The 3D canvas exists and fills the viewport (after r3f sizes it).
    const canvas = page.locator('.viewer-layer canvas');
    await expect(canvas).toBeVisible();
    const vp = page.viewportSize()!;
    await expect
      .poll(async () => (await canvas.boundingBox())!.height, { timeout: 15000 })
      .toBeGreaterThan(vp.height * 0.8);
    expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(vp.width - 1);

    // The inspector opens from the non-modal Controls handle.
    await openControls(page);
    await expect(page.locator('.world-status')).toContainText(/structures/);
    await expect(page.getByText('Summary', { exact: true })).toBeVisible();
    await expect(page.locator('.parameter-section')).toBeVisible();

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('renders a non-trivial scene (the diorama is actually drawn)', async ({ page }) => {
    await page.goto('/');
    // Confirm a live WebGL context exists.
    const hasGl = await page.evaluate(() => {
      const canvas = document.querySelector('.viewer-layer canvas') as HTMLCanvasElement | null;
      if (!canvas) return false;
      return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    });
    expect(hasGl).toBe(true);

    // A rendered, shaded 3D scene compresses to a much larger PNG than a flat
    // clear color. Use the screenshot size as a robust "something is drawn" proxy.
    await page.waitForTimeout(1000);
    const shot = await page.locator('.viewer-layer canvas').screenshot();
    expect(shot.byteLength).toBeGreaterThan(20000);
  });

  test('Generate applies a new seed and updates the summary', async ({ page }) => {
    await page.goto(FAST_SCENARIO);
    await openControls(page);
    const seed = page.locator('#seed');
    await seed.fill('porthaven');
    await clickGenerate(page);
    await waitForGeneratedSeed(page, 'porthaven');
    await openSummary(page);
    await expect(page.getByText(/porthaven \(#/)).toBeVisible();
  });

  test('moving a slider does NOT regenerate until Generate is pressed', async ({ page }) => {
    await page.goto(FAST_SCENARIO);
    await openSummary(page);
    // Read the current building count from the summary.
    const buildingsDd = page.locator('.summary-row', { hasText: 'Buildings' }).locator('dd');
    const before = await buildingsDd.textContent();

    // Force settlement pressure to the minimum without pressing Generate.
    const settlement = page.locator('#p-settlementPressure');
    await settlement.fill('0');
    // Summary must be unchanged (no live regeneration).
    await expect(buildingsDd).toHaveText(before!);

    // Now press Generate — the summary should change.
    await clickGenerate(page);
    await waitForGeneratedSeed(page, 'aldermarch');
    await expect(buildingsDd).not.toHaveText(before!);
  });

  test('same seed + params reproduces the same building count (determinism)', async ({ page }) => {
    test.setTimeout(75_000);

    await page.goto(FAST_SCENARIO);
    await openControls(page);
    await page.locator('#seed').fill('repeatable');
    await clickGenerate(page);
    await waitForGeneratedSeed(page, 'repeatable');
    await openSummary(page);
    await expect(page.getByText(/repeatable \(#/)).toBeVisible();
    const dd = page.locator('.summary-row', { hasText: 'Buildings' }).locator('dd');
    const first = await dd.textContent();

    await page.reload();
    await openControls(page);
    await page.locator('#seed').fill('repeatable');
    await clickGenerate(page);
    await waitForGeneratedSeed(page, 'repeatable');
    await openSummary(page);
    await expect(page.getByText(/repeatable \(#/)).toBeVisible();
    await expect(dd).toHaveText(first!);
  });

  test('Reset camera control is available', async ({ page }) => {
    await page.goto('/');
    await openControls(page);
    await expect(page.getByRole('button', { name: 'Reset camera' })).toBeVisible();
  });
});
