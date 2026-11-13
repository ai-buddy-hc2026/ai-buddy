const CHAT_ERROR_MESSAGES: Record<string, string> = {
  AI_UNAVAILABLE: 'Ассистент сейчас недоступен. Попробуйте позже.',
  LLM_UNAVAILABLE: 'Ассистент сейчас недоступен. Попробуйте позже.',
  LLM_TIMEOUT: 'Ответ задерживается. Попробуйте отправить вопрос ещё раз.',
  GENERATION_TIMEOUT: 'Ответ задерживается. Попробуйте отправить вопрос ещё раз.',
  TOOL_FAILED: 'Не удалось получить данные для ответа. Попробуйте позже.',
  STREAM_INTERRUPTED: 'Соединение прервалось до завершения ответа. Повторите попытку.',
  INVALID_AI_EVENT: 'Не удалось обработать ответ. Попробуйте ещё раз.',
  BUFFER_LIMIT: 'Ответ оказался слишком большим. Сформулируйте вопрос короче.',
  PERSISTENCE_ERROR: 'Не удалось сохранить ответ. Попробуйте ещё раз.',
  SERVICE_UNAVAILABLE: 'Сервис временно недоступен. Попробуйте позже.',
  UNAUTHORIZED: 'Сессия завершилась. Обновите страницу и войдите снова.',
}

export function chatErrorMessage(code: string | undefined): string {
  return (code && CHAT_ERROR_MESSAGES[code]) || 'Не удалось получить ответ. Попробуйте ещё раз.'
}
