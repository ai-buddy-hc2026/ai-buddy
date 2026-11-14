import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useConfirmAction } from '@/entities/actions'
import { formatSlot } from '@/entities/calendar'
import { getEmployee, type Employee } from '@/entities/employees'
import { useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { errorMessage } from '@/shared/api/http'
import { IsoArt } from '@/shared/iso'
import { DEMO_TODAY } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Eyebrow,
  Note,
  Skeleton,
  SwitchRow,
  Tag,
  toast,
} from '@/shared/ui'
import { COFFEE_OPTED_IN, EMPTY_WEEK, useCoffee, useSetCoffeeWeek, type CoffeeWeek } from './data'
import { makePairs, proposeTimes, weekOf } from './logic'
import s from './people.module.css'

const WEEK = weekOf(DEMO_TODAY)

function namesOf(people: readonly Employee[]): string {
  return people.map((p) => `${p.short} (${p.teamName})`).join(', ')
}

function Pair({
  self,
  partners,
  week,
}: {
  self: Employee
  partners: Employee[]
  week: CoffeeWeek
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const times = proposeTimes(
    DEMO_TODAY,
    [self, ...partners].map((p) => p.workHours),
  )
  const [picked, setPicked] = useState(times[0])
  const confirm = useConfirmAction()
  const setWeek = useSetCoffeeWeek()
  const shared = partners.flatMap((p) => p.interests.filter((tag) => self.interests.includes(tag)))
  const first = partners[0]

  const send = () =>
    confirm.mutate(
      {
        kind: 'message',
        title: 'Приглашение на random coffee',
        details: [
          { label: 'Кому', value: partners.map((p) => p.name).join(', ') },
          { label: 'Когда', value: formatSlot(picked) },
        ],
        idempotencyKey: `coffee-${WEEK}-${self.id}`,
        status: 'sent',
      },
      {
        onSuccess: () =>
          setWeek.mutate(
            { week: WEEK, patch: { proposal: picked } },
            { onError: (error) => toast.error(errorMessage(error)) },
          ),
        onError: (error) =>
          toast.error(errorMessage(error), { label: t('Повторить', 'Retry'), run: send }),
      },
    )

  const skip = () =>
    setWeek.mutate(
      { week: WEEK, patch: { skipped: true } },
      { onError: (error) => toast.error(errorMessage(error)) },
    )

  return (
    <Card className={s.pair} index={0} aria-labelledby="people-pair">
      <Eyebrow>{t('Пара этой недели', 'Pair of the week')}</Eyebrow>
      <div className={s.pairAvatars} aria-hidden>
        {[self, ...partners].map((p) => (
          <Avatar key={p.id} name={p.name} color={p.color} size={64} />
        ))}
      </div>
      <h2 id="people-pair" className={s.bigTitle}>
        {partners.length > 1
          ? t(
              `Вас трое: ${partners.map((p) => p.short).join(' и ')}`,
              `Three of you: ${partners.map((p) => p.short).join(' and ')}`,
            )
          : t(`Твоя пара - ${first.short}`, `Your pair is ${first.short}`)}
      </h2>
      <p className="t-muted">{namesOf(partners)}</p>
      {shared.length > 0 && (
        <ChipRow isWrap aria-label={t('Общие увлечения', 'Shared interests')}>
          {[...new Set(shared)].map((tag) => (
            <Tag key={tag} icon="heart">
              {tag}
            </Tag>
          ))}
        </ChipRow>
      )}

      {week.proposal ? (
        <div aria-live="polite" className={s.pairDone}>
          <Note
            tone="success"
            title={t(
              `Приглашение отправлено на ${formatSlot(week.proposal, lang)}`,
              `Invite sent for ${formatSlot(week.proposal, lang)}`,
            )}
          >
            {t(
              '20 минут, кухня или онлайн. Ответ придёт в чат',
              '20 minutes, kitchen or online. The reply comes to chat',
            )}
          </Note>
          <Link to="/chats" search={{ c: first.id }} className={s.linkBtn}>
            {t(`Открыть чат с ${first.short}`, `Open chat with ${first.short}`)}
          </Link>
        </div>
      ) : (
        <>
          <p className={s.pairHint}>
            {t('Общее свободное время на 20 минут:', 'Common free time for 20 minutes:')}
          </p>
          <ChipRow isWrap role="group" aria-label={t('Время встречи', 'Meeting time')}>
            {times.map((time) => (
              <Chip key={time} isSelected={time === picked} onClick={() => setPicked(time)}>
                {formatSlot(time, lang)}
              </Chip>
            ))}
          </ChipRow>
          <div className={s.pairActions}>
            <Button
              variant="primary"
              icon="send"
              onClick={send}
              isLoading={confirm.isPending || setWeek.isPending}
            >
              {t('Предложить время', 'Propose time')}
            </Button>
            <Button variant="ghost" onClick={skip} disabled={setWeek.isPending}>
              {t('Пропустить неделю', 'Skip this week')}
            </Button>
          </div>
        </>
      )}
      <IsoArt name="coffee" className={s.pairArt} isFloating />
    </Card>
  )
}

function CoffeeBody({ self }: { self: Employee }) {
  const t = useT()
  const coffee = useCoffee()
  const setWeek = useSetCoffeeWeek()

  if (coffee.isPending) return <Skeleton height={360} radius="var(--radius-card)" />
  if (coffee.isError) {
    return (
      <ErrorState
        text={t('Не загрузились пары', 'Could not load pairs')}
        onRetry={() => void coffee.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }

  const week = coffee.data.weeks[WEEK] ?? EMPTY_WEEK
  if (week.skipped) {
    return (
      <Card className={s.pair} index={0}>
        <EmptyState
          art={<IsoArt name="coffee" />}
          title={t('Эту неделю пропускаешь', 'Skipping this week')}
          text={t('Новая пара придёт в понедельник в 11:00', 'A new pair comes on Monday at 11:00')}
          action={
            <Button
              onClick={() => setWeek.mutate({ week: WEEK, patch: { skipped: false } })}
              isLoading={setWeek.isPending}
            >
              {t('Всё-таки участвую', 'I am in after all')}
            </Button>
          }
        />
      </Card>
    )
  }

  const others = COFFEE_OPTED_IN.filter((id) => id !== self.id)
    .map(getEmployee)
    .filter((e): e is Employee => e !== undefined)
  const groups = makePairs([self, ...others], coffee.data.history, WEEK)
  const mine = groups.find((group) => group.includes(self.id)) ?? []
  const partners = mine
    .filter((id) => id !== self.id)
    .map(getEmployee)
    .filter((e): e is Employee => e !== undefined)

  if (partners.length === 0) {
    return (
      <Card className={s.pair} index={0}>
        <EmptyState
          art={<IsoArt name="coffee" />}
          title={t('Пока пары нет', 'No pair yet')}
          text={t(
            'Участников мало, подберу в понедельник',
            'Few people joined, I will match on Monday',
          )}
        />
      </Card>
    )
  }
  return <Pair self={self} partners={partners} week={week} />
}

/** Вкладка «Random coffee» (идея 20): по желанию, пары из разных команд без повторов. */
export function CoffeeTab() {
  const t = useT()
  const user = useUser()
  const isOn = useSettings((state) => state.toggles.randomCoffee)
  const setToggle = useSettings((state) => state.setToggle)

  return (
    <div className={s.grid}>
      {isOn ? (
        <CoffeeBody self={user.employee} />
      ) : (
        <Card className={s.pair} index={0}>
          <EmptyState
            art={<IsoArt name="coffee" isFloating />}
            title={t('Random coffee со стажёрами', 'Random coffee with interns')}
            text={t(
              'Раз в неделю подберу стажёра из другой команды на 20 минут кофе',
              'Once a week I match you with an intern from another team for a 20-minute coffee',
            )}
            action={
              <Button variant="accent" onClick={() => setToggle('randomCoffee', true)}>
                {t('Участвовать', 'Join')}
              </Button>
            }
          />
        </Card>
      )}
      <Card className={s.rules} index={1} aria-labelledby="people-coffee-rules">
        <h2 id="people-coffee-rules" className={s.cardTitle}>
          {t('Как это работает', 'How it works')}
        </h2>
        <ul className={s.rulesList}>
          <li>
            {t('Пары собираю по понедельникам в 11:00', 'Pairs are made on Mondays at 11:00')}
          </li>
          <li>{t('Только из разных команд, без повторов', 'Different teams only, no repeats')}</li>
          <li>{t('Нечётное число - будет тройка', 'Odd number - one group of three')}</li>
          <li>
            {t(
              'Приглашение уходит только по твоей кнопке',
              'Invites go out only when you press the button',
            )}
          </li>
        </ul>
        <SwitchRow
          title={t('Участвовать', 'Take part')}
          hint={t('Можно выключить в любой момент', 'Turn off any time')}
          isChecked={isOn}
          onChange={(next) => setToggle('randomCoffee', next)}
        />
      </Card>
    </div>
  )
}
