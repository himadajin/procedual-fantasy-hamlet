/**
 * Repository-managed material assets.
 *
 * Procedural geometry remains the source of truth for buildings and terrain.
 * Entries here are only for controlled texture/material support, and all
 * runtime asset references should flow through this manifest.
 */
export type MaterialAssetUse =
  | 'stone'
  | 'wood'
  | 'roof'
  | 'ground'
  | 'vegetation'
  | 'water'
  | 'atmosphere'
  | 'ui';

export interface MaterialAsset {
  id: string;
  use: MaterialAssetUse;
  path: string;
  width: number;
  height: number;
  tileable: boolean;
  source: 'procedural' | 'handmade' | 'generated';
  notes: string;
}

export const MATERIAL_ASSETS: readonly MaterialAsset[] = [];
