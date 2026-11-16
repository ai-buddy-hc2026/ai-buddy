import { IsoBox, IsoScene, IsoTile, sortByDepth, type Box, type IsoGrid } from '@/shared/iso'

type ArtBox = Box & { color: string }

const GRID: IsoGrid = { tileW: 26, tileH: 15, originX: 110, originY: 40 }

/* Маленький зал: сцена с экраном и ряды стульев четырёх цветов Авито */
const BOXES: ArtBox[] = [
  { x: 0, y: 0, w: 4, d: 1.2, h: 6, color: 'var(--iso-ink)' },
  { x: 0.6, y: 0.2, z: 6, w: 2.8, d: 0.3, h: 30, color: 'var(--brand-blue)' },
  { x: 0.4, y: 2.2, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-green)' },
  { x: 1.4, y: 2.2, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-red)' },
  { x: 2.4, y: 2.2, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-violet)' },
  { x: 0.4, y: 3.3, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-yellow)' },
  { x: 1.4, y: 3.3, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-green)' },
  { x: 2.4, y: 3.3, w: 0.7, d: 0.7, h: 8, color: 'var(--brand-blue)' },
]

/** Изометрическая сцена раздела «События». Декоративная. */
export function EventsArt({ className }: { className?: string }) {
  return (
    <IsoScene width={220} height={150} grid={GRID} className={className}>
      <IsoTile x={-0.4} y={-0.4} w={4.8} d={5} color="var(--iso-ground)" />
      {sortByDepth(BOXES).map((box, i) => (
        <IsoBox key={i} {...box} />
      ))}
    </IsoScene>
  )
}
