import { IsoArt } from '@/shared/iso'
import { Card, EmptyState, Page, PageHeader } from '@/shared/ui'

/** Временная заглушка экрана, пока фича не готова. */
export function Placeholder({ title }: { title: string }) {
  return (
    <Page>
      <PageHeader title={title} />
      <Card index={1}>
        <EmptyState
          title="Экран строится"
          text="Скоро здесь появится раздел"
          art={<IsoArt name="plot" />}
        />
      </Card>
    </Page>
  )
}
