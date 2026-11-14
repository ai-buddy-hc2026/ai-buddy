import { useState } from 'react'
import { useConfirmAction, type Action } from '@/entities/actions'
import { mustEmployee } from '@/entities/employees'
import { errorMessage } from '@/shared/api/http'
import { useT } from '@/shared/lib/i18n'
import { Button, Dialog, Input, Note, Textarea, toast } from '@/shared/ui'
import type { Term } from './data'
import { proposalDraft, validateProposal, type ProposalError } from './logic'
import { SimplicityCheck } from './SimplicityCheck'
import s from './glossary.module.css'

/** Владелец словаря: ему уходит предложение нового термина. */
const GLOSSARY_OWNER_ID = 'ilya'

type Props = {
  isOpen: boolean
  onClose: () => void
  terms: readonly Term[]
  initialTerm: string
}

/** «Предложить термин»: черновик -> «Отправить» -> запись в истории действий. */
export function ProposeDialog({ isOpen, onClose, terms, initialTerm }: Props) {
  const t = useT()
  const confirm = useConfirmAction()
  const owner = mustEmployee(GLOSSARY_OWNER_ID)
  const [term, setTerm] = useState(initialTerm)
  const [definition, setDefinition] = useState('')
  const [error, setError] = useState<ProposalError | null>(null)
  const [result, setResult] = useState<Action | null>(null)

  const errorText: Record<ProposalError, string> = {
    term: t('Термин - от 2 до 40 символов', 'Term must be 2-40 characters'),
    definition: t('Объясни хотя бы в 10 символах', 'Explain in at least 10 characters'),
    duplicate: t('Такой термин уже есть в словаре', 'This term is already in the glossary'),
  }

  const send = () => {
    const checked = validateProposal({ term, definition }, terms)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    setError(null)
    confirm.mutate(proposalDraft(checked.proposal, owner.name), {
      onSuccess: (action) => setResult(action),
      onError: (err) =>
        toast.error(`${t('Не отправилось', 'Not sent')}: ${errorMessage(err)}`, {
          label: t('Повторить', 'Retry'),
          run: send,
        }),
    })
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('Предложить термин', 'Suggest a term')}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t('Готово', 'Done')}
          </Button>
        ) : (
          <>
            <Button variant="primary" icon="send" onClick={send} isLoading={confirm.isPending}>
              {t('Отправить', 'Send')}
            </Button>
            <Button onClick={onClose}>{t('Отмена', 'Cancel')}</Button>
          </>
        )
      }
    >
      {result ? (
        <Note tone="success" title={t('Отправлено', 'Sent')}>
          {t(
            `${owner.name} получит предложение. Номер ${result.externalId ?? ''}, запись есть в истории действий`,
            `${owner.name} will get it. Number ${result.externalId ?? ''}, saved to action history`,
          )}
        </Note>
      ) : (
        <div className={s.form}>
          <p className="t-s t-muted">
            {t(
              `Это черновик. Уйдёт владельцу словаря (${owner.name}) только по кнопке «Отправить»`,
              `This is a draft. It goes to the glossary owner (${owner.name}) only when you press Send`,
            )}
          </p>
          <Input
            label={t('Термин', 'Term')}
            value={term}
            maxLength={40}
            onChange={(event) => setTerm(event.target.value)}
            error={error === 'term' || error === 'duplicate' ? errorText[error] : undefined}
          />
          <Textarea
            label={t('Как объяснить новичку', 'How to explain it to a newcomer')}
            value={definition}
            maxLength={300}
            rows={3}
            onChange={(event) => setDefinition(event.target.value)}
            error={error === 'definition' ? errorText.definition : undefined}
          />
          {definition.trim() !== '' && <SimplicityCheck text={definition} />}
        </div>
      )}
    </Dialog>
  )
}
