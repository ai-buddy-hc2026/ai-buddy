import {
  ChatMessageSchema,
  OnboardingPlanSchema,
  UserSchema,
  type ChatMessage,
  type OnboardingPlan,
  type User,
} from './schemas'

// Заглушки до появления API. Данные проходят через Zod, как будут проходить ответы бэкенда.

export const mockUser: User = UserSchema.parse({
  id: 'u-1',
  login: 'intern_anya',
  name: 'Аня Смирнова',
  role: 'intern',
  team: 'Команда платформы',
})

export const mockPlan: OnboardingPlan = OnboardingPlanSchema.parse({
  nextStep: 'Настроить окружение по инструкции',
  stages: [
    {
      id: 's-1',
      title: 'Неделя 1',
      tasks: [
        { id: 't-1', title: 'Получить доступы', status: 'done', deadline: 'день 1' },
        { id: 't-2', title: 'Познакомиться с наставником', status: 'done', deadline: 'день 2' },
        { id: 't-3', title: 'Настроить окружение', status: 'in_progress', deadline: 'день 3' },
      ],
    },
    {
      id: 's-2',
      title: 'Неделя 2',
      tasks: [
        { id: 't-4', title: 'Разобрать процесс code review', status: 'todo', deadline: 'день 8' },
        { id: 't-5', title: 'Сделать первый PR', status: 'todo', deadline: 'день 10' },
      ],
    },
    {
      id: 's-3',
      title: 'Недели 3-4',
      tasks: [
        { id: 't-6', title: 'Взять задачу из трекера', status: 'todo', deadline: 'день 15' },
        { id: 't-7', title: 'Встреча 1:1 с наставником', status: 'todo', deadline: 'день 20' },
      ],
    },
  ],
})

export const mockMessages: ChatMessage[] = ChatMessageSchema.array().parse([
  {
    id: 'm-1',
    author: 'assistant',
    text: 'Привет, Аня! Я AI-buddy. Отвечу на вопросы по онбордингу и подскажу следующий шаг.',
  },
  { id: 'm-2', author: 'user', text: 'Как оформить отгул?' },
  {
    id: 'm-3',
    author: 'assistant',
    text: 'Заявку на отгул подают заранее и согласуют с руководителем. Могу подготовить заявку, если скажешь даты.',
    source: 'Порядок оформления отгула',
  },
])
