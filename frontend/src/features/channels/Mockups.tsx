import { useT } from '@/shared/lib/i18n'
import { BrandMark, Icon } from '@/shared/ui'
import s from './channels.module.css'

/** Мокап Telegram-диалога с buddy. Данные выдуманы, кнопки ненастоящие. */
export function TelegramMock() {
  const t = useT()
  return (
    <figure className={s.mock}>
      <div className={s.phone}>
        <div className={s.phoneHead}>
          <BrandMark size={28} />
          <span>
            <b>AI-buddy</b>
            <span className={s.muted}>{t('бот', 'bot')}</span>
          </span>
        </div>
        <ol className={s.thread}>
          <li className={s.mine}>оформи отгул на пятницу</li>
          <li className={s.bot}>
            <b>Заявка на отгул</b>
            <span>пт, 13.11 · весь день</span>
            <span>Согласует: Мария Руководова</span>
            <span className={s.inline} aria-hidden>
              <span className={s.inlineMain}>Отправить</span>
              <span>Изменить</span>
            </span>
          </li>
          <li className={s.bot}>
            Готово, заявка ABS-1042 сохранена. Илье написал, что тебя не будет
          </li>
        </ol>
      </div>
      <figcaption className={s.caption}>
        {t('Пример диалога, данные выдуманы', 'Sample chat, data is made up')}
      </figcaption>
    </figure>
  )
}

/** Мокап боковой панели расширения рядом со страницей мок-вики. */
export function ExtensionMock() {
  const t = useT()
  return (
    <figure className={s.mock}>
      <div className={s.browser}>
        <div className={s.address}>
          <Icon name="lock" size={14} />
          <span>wiki.mock/backend/deploy</span>
        </div>
        <div className={s.browserBody}>
          <div className={s.wiki}>
            <b>Деплой сервисов</b>
            <span>
              Изменения уходят в прод через <mark className={s.mark}>релиз-трейн</mark> по средам
            </span>
            <span className={s.line} />
            <span className={s.line} />
            <span className={s.lineShort} />
          </div>
          <aside className={s.panel} aria-label={t('Панель buddy', 'buddy panel')}>
            <span className={s.panelHead}>
              <BrandMark size={20} />
              <b>buddy</b>
            </span>
            <span className={s.bot}>
              В твоей команде деплой через пайплайн ads-deploy, без релиз-трейна
              <span className={s.muted}>
                Источник: «Гайд по деплою», проверен 02.11.2026, владелец: Олег Деплоев
              </span>
            </span>
          </aside>
        </div>
      </div>
      <figcaption className={s.caption}>
        {t('Пример страницы мок-вики, данные выдуманы', 'Sample mock wiki page, data is made up')}
      </figcaption>
    </figure>
  )
}
