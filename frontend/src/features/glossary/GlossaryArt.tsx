import { IsoBox, IsoScene, IsoTile, sortByDepth, type Box, type IsoGrid } from '@/shared/iso'

type ArtBox = Box & { color: string }

const GRID: IsoGrid = { tileW: 24, tileH: 14, originX: 110, originY: 46 }

/* Раскрытый словарь на подставке и стопка карточек-терминов четырёх цветов */
const BOXES: ArtBox[] = [
  { x: 0, y: 0.4, w: 3.2, d: 2.2, h: 6, color: 'var(--iso-ink)' },
  { x: 0.1, y: 0.5, z: 6, w: 1.45, d: 2, h: 4, color: 'var(--iso-plot)' },
  { x: 1.65, y: 0.5, z: 6, w: 1.45, d: 2, h: 4, color: 'var(--iso-plot)' },
  { x: 0.3, y: 0.8, z: 10, w: 1, d: 0.2, h: 1, color: 'var(--brand-blue)' },
  { x: 0.3, y: 1.3, z: 10, w: 0.8, d: 0.2, h: 1, color: 'var(--brand-blue)' },
  { x: 1.9, y: 0.8, z: 10, w: 1, d: 0.2, h: 1, color: 'var(--brand-green)' },
  { x: 3.6, y: 2.4, w: 1, d: 0.7, h: 6, color: 'var(--brand-green)' },
  { x: 3.6, y: 2.4, z: 6, w: 1, d: 0.7, h: 6, color: 'var(--brand-blue)' },
  { x: 3.6, y: 2.4, z: 12, w: 1, d: 0.7, h: 6, color: 'var(--brand-violet)' },
  { x: 3.6, y: 2.4, z: 18, w: 1, d: 0.7, h: 6, color: 'var(--brand-red)' },
]

/** Изометрическая сцена раздела «Словарь». Декоративная. */
export function GlossaryArt({ className }: { className?: string }) {
  return (
    <IsoScene width={220} height={150} grid={GRID} className={className}>
      <IsoTile x={-0.4} y={-0.2} w={5.4} d={3.8} color="var(--iso-ground)" />
      {sortByDepth(BOXES).map((box, i) => (
        <IsoBox key={i} {...box} />
      ))}
    </IsoScene>
  )
}
