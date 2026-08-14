/** Rule-based semantic classification. No AI service is involved. */

export type SemanticType =
  /** door / gate / hatch / lid / panel — hinged, one-shot swing. */
  | 'door'
  /** fan / blower / impeller / rotor — continuous spin. */
  | 'fan'
  /** drawer / tray / slider — linear travel. */
  | 'drawer'
  /** motor / wheel / generic rotating part. */
  | 'rotating'
  /** button / switch / lever — small triggered motion. */
  | 'switch'
  /** Animated, but no pattern matched. */
  | 'animated'
  | 'unknown'

export type EvidenceSource = 'name' | 'hierarchy' | 'shape' | 'animation'

export interface SemanticEvidence {
  /** Human-readable reason shown in the UI. */
  reason: string
  weight: number
  type: SemanticType
  /** Which rule family produced it; only "animation" unlocks high confidence. */
  source: EvidenceSource
}

export interface SemanticResult {
  type: SemanticType
  /** 0..1. Name-only matches are deliberately capped low. */
  confidence: number
  reasons: string[]
  evidence: SemanticEvidence[]
  scores: Partial<Record<SemanticType, number>>
  /** True when animation data backs the classification. */
  animationBacked: boolean
}

export const SEMANTIC_LABELS: Record<SemanticType, string> = {
  door: 'Door / Panel',
  fan: 'Fan / Rotor',
  drawer: 'Drawer / Slider',
  rotating: 'Rotating part',
  switch: 'Switch / Button',
  animated: 'Animated component',
  unknown: 'Static',
}
