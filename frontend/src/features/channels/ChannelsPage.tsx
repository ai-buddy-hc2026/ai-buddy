import { useNavigate } from '@tanstack/react-router'
import { useSettings } from '@/entities/settings'
import { useT } from '@/shared/lib/i18n'
import { Badge, Button, Card, Icon, Note, Page } from '@/shared/ui'
import { ChannelsArt } from './ChannelsArt'
import { CHANNELS, type Channel } from './data'
import { ExtensionMock, TelegramMock } from './Mockups'
import s from './channels.module.css'

function ChannelCard({ channel, index }: { channel: Channel; index: number }) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const navigate = useNavigate()
  const titleId = `channel-${channel.id}`

  return (
    <Card as="article" className={s.channel} index={index} aria-labelledby={titleId}>
      <div className={s.channelHead}>
        <Icon name={channel.icon} size={28} />
        <h2 id={titleId} className={s.channelTitle}>
          {channel.title[lang]}
        </h2>
        <Badge tone="pay" icon="sparkle">
          {t('Прототип', 'Prototype')}
        </Badge>
      </div>
      <p className={s.channelLead}>{channel.lead[lang]}</p>

      {channel.id === 'telegram' ? <TelegramMock /> : <ExtensionMock />}

      <div>
        <h3 className={s.subTitle}>{t('Что умеет', 'What it does')}</h3>
        <ul className={s.abilities}>
          {channel.abilities.map((ability) => (
            <li key={ability.ru}>
              <Icon name="check" size={18} />
              <span>{ability[lang]}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="t-s t-muted">{channel.howItWorks[lang]}</p>
      <div>
        <Button
          icon="arrowRight"
          onClick={() => void navigate({ to: channel.tryIt.to, search: channel.tryIt.search })}
        >
          {channel.tryIt.label[lang]}
        </Button>
      </div>
    </Card>
  )
}

export function ChannelsPage() {
  const t = useT()
  return (
    <Page className={s.grid}>
      <Card className={s.hero} index={0}>
        <div className={s.heroText}>
          <h1 className={s.title}>{t('Каналы', 'Channels')}</h1>
          <p className={s.lead}>
            {t(
              'buddy там, где ты уже работаешь: в мессенджере и рядом с вики. Пока это прототипы',
              'buddy where you already work: in the messenger and next to the wiki. These are prototypes for now',
            )}
          </p>
          <Note tone="info" title={t('Права те же, что в вебе', 'Same rights as on the web')}>
            {t(
              'Каналы ходят в тот же API. Действия отправляются только после твоего подтверждения',
              'Channels call the same API. Actions are sent only after you confirm',
            )}
          </Note>
        </div>
        <ChannelsArt className={s.heroArt} />
      </Card>
      {CHANNELS.map((channel, i) => (
        <ChannelCard key={channel.id} channel={channel} index={i + 1} />
      ))}
    </Page>
  )
}
