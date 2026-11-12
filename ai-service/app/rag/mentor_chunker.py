"""
Функция для разбивки ответов наставников на чанки и генерации эмбеддингов.
Используется при сохранении новых Q&A в базу знаний.
"""

from typing import Dict, List


def chunk_mentor_response(text: str, embedder_obj) -> List[Dict]:
    """
    Разбивает длинный текст ответа на смысловые блоки (предложения)
    и генерирует для каждого векторное представление.

    Args:
        text: Сырой текст ответа наставника.
        embedder_obj: Объект с методом encode(texts) -> np.ndarray.

    Returns:
        Список словарей вида {"text": "...", "embedding": [...]}
    """
    if not text.strip():
        return []

    # 1. Разбиение на предложения (простая эвристика по точкам)
    sentences = [s.strip() for s in text.split(".") if s.strip()]

    chunks = []
    batch_texts = []
    batch_indices = []

    for i, sent in enumerate(sentences):
        if len(sent) < 10:  # Игнорируем слишком короткие обрывки
            continue

        batch_texts.append(sent)
        batch_indices.append(i)

        # Обрабатываем батчами по 10 предложений
        if len(batch_texts) >= 10 or i == len(sentences) - 1:
            vectors = embedder_obj.encode(batch_texts)

            for j, vec in enumerate(vectors):
                chunks.append(
                    {
                        "original_index": batch_indices[j],
                        "text": batch_texts[j],
                        "embedding": vec.tolist(),
                        "source_type": "mentor_answer",
                    },
                )

            batch_texts.clear()
            batch_indices.clear()

    return chunks
