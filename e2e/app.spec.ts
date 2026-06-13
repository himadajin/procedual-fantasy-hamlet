import { test, expect } from '@playwright/test';

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
      .poll(async () => (await canvas.boundingBox())!.height, { timeout: 5000 })
      .toBeGreaterThan(vp.height * 0.8);
    expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(vp.width - 1);

    // A generated summary is shown immediately (default seed/params).
    await expect(page.getByRole('heading', { name: 'Generation summary' })).toBeVisible();
    await expect(page.getByText(/structures$/)).toBeVisible();

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
    await page.goto('/');
    const seed = page.locator('#seed');
    await seed.fill('porthaven');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText(/porthaven \(#/)).toBeVisible();
  });

  test('moving a slider does NOT regenerate until Generate is pressed', async ({ page }) => {
    await page.goto('/');
    // Read the current building count from the summary.
    const buildingsDd = page.locator('.summary-row', { hasText: 'Buildings' }).locator('dd');
    const before = await buildingsDd.textContent();

    // Force settlement pressure to the minimum without pressing Generate.
    const settlement = page.locator('#p-settlementPressure');
    await settlement.fill('0');
    // Summary must be unchanged (no live regeneration).
    await expect(buildingsDd).toHaveText(before!);

    // Now press Generate — the summary should change.
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(buildingsDd).not.toHaveText(before!);
  });

  test('same seed + params reproduces the same building count (determinism)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#seed').fill('repeatable');
    await page.getByRole('button', { name: 'Generate' }).click();
    const dd = page.locator('.summary-row', { hasText: 'Buildings' }).locator('dd');
    const first = await dd.textContent();

    await page.reload();
    await page.locator('#seed').fill('repeatable');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(dd).toHaveText(first!);
  });

  test('Reset camera control is available', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Reset camera' })).toBeVisible();
  });
});
