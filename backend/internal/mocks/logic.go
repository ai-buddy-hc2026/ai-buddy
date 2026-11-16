// Package mocks реализует синтетические корпоративные системы: сотрудники,
// календарь приёмных часов, обучение, доступы и карту офиса.
package mocks

import (
	"strings"
	"time"
	"unicode/utf8"
)

const (
	AccessNotRequested = "not_requested"
	AccessPending      = "pending"
	AccessGranted      = "granted"

	maxSimilarPlaces = 3
	minWordRunes     = 3
	prefixRunes      = 4
)

type Employee struct {
	Code     string   `json:"code"`
	TeamID   *string  `json:"team_id"`
	UserID   *string  `json:"user_id"`
	Name     string   `json:"name"`
	Title    string   `json:"title"`
	Kind     string   `json:"kind"`
	Tags     []string `json:"tags"`
	AskAbout string   `json:"ask_about"`
	Birthday *string  `json:"birthday"`
	DeskID   *string  `json:"desk_id"`
}

type Place struct {
	ID           string   `json:"id"`
	Floor        int      `json:"floor"`
	Kind         string   `json:"kind"`
	Name         string   `json:"name"`
	Aliases      []string `json:"aliases"`
	X            float64  `json:"x"`
	Y            float64  `json:"y"`
	W            float64  `json:"w"`
	D            float64  `json:"d"`
	EmployeeCode *string  `json:"employee_code"`
	NodeID       string   `json:"node_id"`
}

// OwnerMatch - результат «Кого спросить»: владелец темы или наставник.
type OwnerMatch struct {
	Owner      *Employee
	MatchedTag *string
	Fallback   bool
}

// MatchOwner ищет первого сотрудника, чей тег встречается в теме. Без совпадения
// возвращает сотрудника fallbackCode (наставника), если он есть в списке.
func MatchOwner(topic string, employees []Employee, fallbackCode string) OwnerMatch {
	query := normalize(topic)
	for i := range employees {
		for _, tag := range employees[i].Tags {
			if key := normalize(tag); strings.TrimSpace(key) != "" && strings.Contains(query, key) {
				matched := tag
				return OwnerMatch{Owner: &employees[i], MatchedTag: &matched}
			}
		}
	}
	for i := range employees {
		if employees[i].Code == fallbackCode {
			return OwnerMatch{Owner: &employees[i], Fallback: true}
		}
	}
	return OwnerMatch{Fallback: true}
}

// FindPlace повторяет поиск фронта: точное вхождение названия или синонима дает
// match, совпадение по началу слова дает до трех похожих мест.
func FindPlace(query string, places []Place) (*Place, []Place) {
	text := normalize(query)
	var words []string
	for _, word := range strings.Fields(text) {
		if utf8.RuneCountInString(word) >= minWordRunes {
			words = append(words, word)
		}
	}
	similar := []Place{}
	for i := range places {
		keys := append([]string{places[i].Name}, places[i].Aliases...)
		partial := false
		for _, key := range keys {
			key = normalize(key)
			if strings.TrimSpace(key) != "" && strings.Contains(text, key) {
				return &places[i], []Place{}
			}
			for _, word := range words {
				if strings.Contains(key, prefix(word, prefixRunes)) {
					partial = true
				}
			}
		}
		if partial && len(similar) < maxSimilarPlaces {
			similar = append(similar, places[i])
		}
	}
	return nil, similar
}

// AccessStatus считает статус по таймеру мока: grantAfter nil - ручная выдача.
func AccessStatus(requestedAt *time.Time, grantAfter *int, now time.Time) (string, *time.Time) {
	if requestedAt == nil {
		return AccessNotRequested, nil
	}
	if grantAfter == nil {
		return AccessPending, nil
	}
	ready := requestedAt.Add(time.Duration(*grantAfter) * time.Second).UTC()
	if now.Before(ready) {
		return AccessPending, &ready
	}
	return AccessGranted, &ready
}

func normalize(text string) string {
	text = strings.ReplaceAll(strings.ToLower(text), "ё", "е")
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'а' && r <= 'я' || r >= '0' && r <= '9' || r == ' ' {
			return r
		}
		if r == '\t' || r == '\n' {
			return ' '
		}
		// Слэш и дефис оставляем: теги вида a/b и k8s-dev.
		if r == '/' || r == '-' {
			return r
		}
		return ' '
	}, text)
}

func prefix(word string, n int) string {
	runes := []rune(word)
	if len(runes) > n {
		runes = runes[:n]
	}
	return string(runes)
}
