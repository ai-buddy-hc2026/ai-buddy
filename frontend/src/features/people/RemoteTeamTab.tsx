import { useState, type FormEvent } from 'react'
import { useColleagues, type Colleague } from '@/entities/colleagues'
import { errorMessage } from '@/shared/api/http'
import { cn } from '@/shared/lib/cn'
import { useT } from '@/shared/lib/i18n'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChipRow,
  EmptyState,
  ErrorState,
  Eyebrow,
  Input,
  Skeleton,
  Tag,
  toast,
} from '@/shared/ui'
import s from './people.module.css'
import { PeopleArt } from './PeopleArt'

function ColleagueCard({ employee }: { employee: Colleague }) {
  const t = useT()
  const copyContact = async () => {
    if (!employee.contact_handle) return
    try {
      await navigator.clipboard.writeText(employee.contact_handle)
      toast(t('Контакт скопирован', 'Contact copied'))
    } catch {
      toast.error(
        t(
          'Не удалось скопировать. Выдели контакт вручную',
          'Could not copy. Select the contact manually',
        ),
      )
    }
  }
  return (
    <Card as="article" className={cn(s.person, s.span4)} aria-label={employee.display_name}>
      <div className={s.personHead}>
        <Avatar name={employee.display_name} size={52} />
        <div className={s.personName}>
          <h3>{employee.display_name}</h3>
          <p className="t-s t-muted">{employee.job_title}</p>
        </div>
      </div>
      {employee.is_key_contact && <Badge>{t('Ключевой контакт', 'Key contact')}</Badge>}
      <p className="t-s t-muted">{employee.team_name}</p>
      {employee.ask_about && (
        <p className={s.askAbout}>
          <span className="t-s t-muted">{t('С чем идти', 'Ask about')}</span>
          {employee.ask_about}
        </p>
      )}
      <ChipRow isWrap>
        {employee.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </ChipRow>
      <div className={s.personActions}>
        {employee.contact_handle ? (
          <>
            <span className="t-s">{employee.contact_handle}</span>
            <Button variant="ghost" onClick={() => void copyContact()}>
              {t('Копировать контакт', 'Copy contact')}
            </Button>
          </>
        ) : (
          <span className="t-s t-muted">{t('Контакт не указан', 'No contact provided')}</span>
        )}
      </div>
    </Card>
  )
}

/** API-справочник без демонстрационных статусов, личных чатов и чужих команд. */
export function RemoteTeamTab() {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const query = useColleagues(search)
  const people = query.data?.pages.flatMap((page) => page.items) ?? []
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSearch(draft.trim())
  }
  return (
    <div className={s.grid}>
      <Card className={cn(s.askCard, s.directorySearch)}>
        <div className={s.askText}>
          <Eyebrow>{t('Коллеги команды', 'Team colleagues')}</Eyebrow>
          <h2 className={s.bigTitle}>{t('К кому обратиться', 'Who to ask')}</h2>
          <form className={s.askForm} onSubmit={submit}>
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              placeholder={t(
                'Имя, должность или тема: мониторинг',
                'Name, job title or topic: monitoring',
              )}
              aria-label={t('Поиск коллег', 'Search colleagues')}
            />
            <Button type="submit">{t('Найти', 'Find')}</Button>
            {search && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft('')
                  setSearch('')
                }}
              >
                {t('Сбросить', 'Reset')}
              </Button>
            )}
          </form>
        </div>
        <PeopleArt className={s.askArt} />
      </Card>
      <h2 className={s.sectionTitle}>{t('Твоя команда', 'Your team')}</h2>
      {query.isPending ? (
        <div className={s.sectionTitle}>
          <Skeleton height={240} />
        </div>
      ) : query.isError ? (
        <div className={s.sectionTitle}>
          <ErrorState text={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <>
          {people.length === 0 && (
            <div className={s.sectionTitle}>
              <EmptyState
                title={
                  search
                    ? t('Коллеги не найдены', 'No colleagues found')
                    : t('В справочнике пока нет коллег', 'No colleagues in the directory yet')
                }
                text={
                  search
                    ? t(
                        'Попробуй другое имя или тему либо сбрось поиск',
                        'Try another name or topic, or reset the search',
                      )
                    : undefined
                }
              />
            </div>
          )}
          {people.map((employee) => (
            <ColleagueCard key={employee.id} employee={employee} />
          ))}
          {query.hasNextPage && (
            <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {t('Показать ещё', 'Show more')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
