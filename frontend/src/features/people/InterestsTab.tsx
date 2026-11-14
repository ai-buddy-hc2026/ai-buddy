import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EMPLOYEES } from '@/entities/employees'
import { useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { errorMessage } from '@/shared/api/http'
import { IsoArt } from '@/shared/iso'
import { plural, useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Note,
  Row,
  Skeleton,
  SwitchRow,
  toast,
} from '@/shared/ui'
import { INTEREST_CHATS, useInterests, useSaveInterests } from './data'
import {
  addInterest,
  allInterestTags,
  interestMatches,
  normalizeInterest,
  removeInterest,
} from './logic'
import s from './people.module.css'

const KNOWN_TAGS = allInterestTags(
  EMPLOYEES,
  INTEREST_CHATS.map((c) => c.tag),
)

function MyInterests({
  tags,
  onSave,
  isSaving,
}: {
  tags: string[]
  onSave: (next: string[]) => void
  isSaving: boolean
}) {
  const t = useT()
  const [value, setValue] = useState('')
  const isShown = useSettings((state) => state.toggles.showInterests)
  const setToggle = useSettings((state) => state.setToggle)
  const suggestions = KNOWN_TAGS.filter((tag) => !tags.includes(tag))

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const tag = normalizeInterest(value, KNOWN_TAGS)
    if (!tag) return
    onSave(addInterest(tags, tag))
    setValue('')
  }

  return (
    <Card className={s.mine} index={0} aria-labelledby="people-mine">
      <div className={s.cardHead}>
        <h2 id="people-mine" className={s.bigTitle}>
          {t('Мои увлечения', 'My interests')}
        </h2>
        <IsoArt name="chat" className={s.headArt} />
      </div>
      {tags.length > 0 ? (
        <ChipRow isWrap aria-label={t('Мои увлечения', 'My interests')}>
          {tags.map((tag) => (
            <Chip
              key={tag}
              isSelected
              onClick={() => onSave(removeInterest(tags, tag))}
              aria-label={t(`Убрать «${tag}»`, `Remove “${tag}”`)}
              disabled={isSaving}
            >
              {tag}
              <Icon name="close" size={14} />
            </Chip>
          ))}
        </ChipRow>
      ) : (
        <p className="t-s t-muted">
          {t('Пока пусто. Напиши, чем увлекаешься', 'Empty for now. Tell me what you like')}
        </p>
      )}
      <form className={s.askForm} onSubmit={handleSubmit}>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('Например: футбол, настолки', 'For example: football, board games')}
          aria-label={t('Новое увлечение', 'New interest')}
          maxLength={40}
          autoComplete="off"
        />
        <Button type="submit" icon="plus" disabled={!value.trim()} isLoading={isSaving}>
          {t('Добавить', 'Add')}
        </Button>
      </form>
      {suggestions.length > 0 && (
        <ChipRow isWrap aria-label={t('Подсказки', 'Suggestions')}>
          {suggestions.map((tag) => (
            <Chip
              key={tag}
              icon="plus"
              onClick={() => onSave(addInterest(tags, tag))}
              disabled={isSaving}
            >
              {tag}
            </Chip>
          ))}
        </ChipRow>
      )}
      <SwitchRow
        title={t('Показывать мои увлечения другим', 'Show my interests to others')}
        hint={t(
          'Тогда тебя увидят в подборках «такие же увлечения»',
          'Then you appear in “same interests” lists',
        )}
        isChecked={isShown}
        onChange={(next) => setToggle('showInterests', next)}
      />
      {!isShown && (
        <Note tone="private" title={t('Видишь только ты', 'Only you see this')}>
          {t(
            'Пока показ выключен, другие не найдут тебя по увлечениям',
            'While this is off, nobody finds you by interests',
          )}
        </Note>
      )}
    </Card>
  )
}

function Chats({ tags }: { tags: string[] }) {
  const t = useT()
  const chats = INTEREST_CHATS.filter((c) => tags.includes(c.tag))

  return (
    <Card className={s.chats} index={1} aria-labelledby="people-chats">
      <h2 id="people-chats" className={s.cardTitle}>
        {t('Чаты по интересам', 'Interest chats')}
      </h2>
      {chats.length === 0 ? (
        <p className="t-s t-muted">
          {t('Добавь увлечение - покажу чат', 'Add an interest and I will show a chat')}
        </p>
      ) : (
        <ul className={s.meetList}>
          {chats.map((chat) => (
            <li key={chat.tag}>
              <Row
                leading={
                  <span className={s.chatIcon}>
                    <Icon name="chat" size={20} />
                  </span>
                }
                title={chat.title}
                subtitle={`${chat.members} ${plural(chat.members, ['человек', 'человека', 'человек'])} · ${chat.note}`}
                trailing={
                  <Link
                    to="/chats"
                    search={{ c: 'buddy', q: `Хочу вступить в чат «${chat.title}»` }}
                    className={s.linkBtn}
                  >
                    {t('Вступить', 'Join')}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Link to="/events" className={s.moreLink}>
        <Icon name="events" size={18} />
        {t('Лента событий: митапы, настолки, забеги', 'Events feed: meetups, games, runs')}
      </Link>
    </Card>
  )
}

function Matches({ tags, selfId }: { tags: string[]; selfId: string }) {
  const t = useT()
  const matches = interestMatches(tags, EMPLOYEES, selfId)

  return (
    <Card className={s.matches} index={2} aria-labelledby="people-matches">
      <h2 id="people-matches" className={s.cardTitle}>
        {t('У кого такие же увлечения', 'Same interests')}
      </h2>
      {matches.length === 0 ? (
        <EmptyState
          art={<IsoArt name="plot" />}
          title={t('Пока никого', 'Nobody yet')}
          text={t('Добавь увлечения, и я найду людей', 'Add interests and I will find people')}
        />
      ) : (
        <ul className={s.matchGrid}>
          {matches.map(({ employee, shared }) => (
            <li key={employee.id} className={s.matchItem}>
              <Avatar
                name={employee.name}
                color={employee.color}
                size={44}
                isOnline={employee.online}
              />
              <span className={s.bdayText}>
                <b>{employee.name}</b>
                <span className="t-s t-muted">
                  {employee.role} · {shared.join(', ')}
                </span>
              </span>
              <Link
                to="/chats"
                search={{
                  c: employee.id,
                  q: `Привет, ${employee.short}! Вижу, ты тоже любишь ${shared[0]}`,
                }}
                className={s.iconLink}
                aria-label={t(`Написать ${employee.short}`, `Message ${employee.short}`)}
              >
                <Icon name="chat" size={20} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Вкладка «Интересы» (идея 22): увлечения, тематические чаты и люди с теми же увлечениями. */
export function InterestsTab() {
  const t = useT()
  const user = useUser()
  const interests = useInterests(user.employee.id)
  const save = useSaveInterests(user.employee.id)

  if (interests.isPending) return <Skeleton height={320} radius="var(--radius-card)" />
  if (interests.isError) {
    return (
      <ErrorState
        text={t('Не загрузились увлечения', 'Could not load interests')}
        onRetry={() => void interests.refetch()}
        retryLabel={t('Повторить', 'Retry')}
      />
    )
  }

  const handleSave = (next: string[]) =>
    save.mutate(next, {
      onError: (error) =>
        toast.error(`${t('Не сохранилось', 'Not saved')}: ${errorMessage(error)}`),
    })

  return (
    <div className={s.grid}>
      <MyInterests tags={interests.data} onSave={handleSave} isSaving={save.isPending} />
      <Chats tags={interests.data} />
      <Matches tags={interests.data} selfId={user.employee.id} />
    </div>
  )
}
