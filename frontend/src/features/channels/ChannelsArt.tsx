import {
  IsoBox,
  IsoPoly,
  IsoScene,
  IsoTile,
  sortByDepth,
  type Box,
  type IsoGrid,
} from '@/shared/iso'

type ArtBox = Box & { color: string }

const GRID: IsoGrid = { tileW: 24, tileH: 14, originX: 120, originY: 40 }

/* Монитор с боковой панелью buddy и телефон с пузырями чата */
const BOXES: ArtBox[] = [
  { x: 0.9, y: 0.6, w: 0.6, d: 0.6, h: 12, color: 'var(--iso-ink)' },
  { x: 0, y: 0.2, z: 12, w: 2.8, d: 0.2, h: 40, color: 'var(--iso-ink)' },
  { x: 3.4, y: 1.6, w: 1.1, d: 0.16, h: 44, color: 'var(--brand-blue)' },
]

/** Изометрическая сцена раздела «Каналы». Декоративная. */
export function ChannelsArt({ className }: { className?: string }) {
  return (
    <IsoScene width={240} height={160} grid={GRID} className={className}>
      <IsoTile x={-0.4} y={-0.4} w={5.4} d={3.8} color="var(--iso-ground)" />
      {sortByDepth(BOXES).map((box, i) => (
        <IsoBox key={i} {...box} />
      ))}
      {/* Экран монитора и панель buddy справа */}
      <IsoPoly
        color="var(--iso-plot)"
        points={[
          [0.15, 0.41, 49],
          [1.9, 0.41, 49],
          [1.9, 0.41, 15],
          [0.15, 0.41, 15],
        ]}
      />
      <IsoPoly
        color="var(--brand-violet)"
        points={[
          [1.95, 0.41, 49],
          [2.65, 0.41, 49],
          [2.65, 0.41, 15],
          [1.95, 0.41, 15],
        ]}
      />
      {/* Пузыри на телефоне */}
      <IsoPoly
        color="var(--iso-plot)"
        points={[
          [3.5, 1.77, 38],
          [4.1, 1.77, 38],
          [4.1, 1.77, 31],
          [3.5, 1.77, 31],
        ]}
      />
      <IsoPoly
        color="var(--brand-green)"
        points={[
          [3.8, 1.77, 26],
          [4.4, 1.77, 26],
          [4.4, 1.77, 19],
          [3.8, 1.77, 19],
        ]}
      />
    </IsoScene>
  )
}
