/**
 * Read-only generation summary. Lives inside the same non-modal panel as the
 * controls — it explains and verifies what was generated, it does not edit it.
 */
import type { WorldSummary } from '../generation/types';

export function Summary({ summary }: { summary: WorldSummary }): JSX.Element {
  const rows: [string, string][] = [
    ['Seed', `${summary.seed} (#${summary.seedValue})`],
    ['Scale', summary.scale],
    ['Buildings', `${summary.buildingCount} structures`],
    ['Central building', summary.monument],
    ['Water', summary.water],
    ['Defenses', summary.defenses],
    ['Vegetation', `${summary.vegetationCount} plants`],
    ['Render load', summary.complexity],
  ];
  return (
    <details className="summary" aria-label="Generation summary" open>
      <summary>Summary</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div className="summary-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
