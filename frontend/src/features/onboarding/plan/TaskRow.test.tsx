import { fireEvent, render, screen } from '@testing-library/react'
import type { Task } from '@/entities/plan'
import { TaskRow } from './TaskRow'

const task: Task = {
  id: 't7',
  title: 'Настроить локальное окружение',
  stage: 1,
  status: 'in_progress',
  due: '2026-11-12',
  note: 'Гайд на 20 минут',
  owner: 'intern',
  source: 'checklist',
  updatedAt: '2026-11-09',
}

function renderRow(props: { isStuck?: boolean; onStatus?: () => void } = {}) {
  const onStatus = props.onStatus ?? vi.fn()
  render(
    <ul>
      <TaskRow task={task} color="var(--brand-blue)" isStuck={props.isStuck} onStatus={onStatus} />
    </ul>,
  )
  return onStatus
}

describe('TaskRow', () => {
  it('закрывает задачу по галочке', () => {
    // Arrange
    const onStatus = renderRow()
    // Act
    fireEvent.click(screen.getByRole('checkbox', { name: task.title }))
    // Assert
    expect(onStatus).toHaveBeenCalledWith('done')
  })

  it('меняет статус через список', () => {
    const onStatus = renderRow()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'blocked' } })
    expect(onStatus).toHaveBeenCalledWith('blocked')
  })

  it('показывает метку зависшей задачи', () => {
    renderRow({ isStuck: true })
    expect(screen.getByText('Давно без движения')).toBeInTheDocument()
  })
})
