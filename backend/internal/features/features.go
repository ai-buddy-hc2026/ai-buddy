// Package features описывает runtime-флаги сценариев (V-10).
// Флаг только выключает сценарий и никогда не выдает дополнительных прав.
package features

import (
	"fmt"
	"slices"
	"strings"
)

const (
	Chat        = "chat"
	Absences    = "absences"
	Escalations = "escalations"
	KBPublish   = "kb_publish"
)

// Keys - все известные флаги в стабильном порядке.
var Keys = []string{Chat, Absences, Escalations, KBPublish}

// Flags хранит выключенные сценарии; нулевое значение включает все.
type Flags struct{ disabled map[string]bool }

// Parse читает список FEATURES_DISABLED через запятую. Неизвестный ключ - ошибка,
// чтобы опечатка в env не оставила сценарий включенным незаметно.
func Parse(raw string) (Flags, error) {
	disabled := make(map[string]bool)
	for _, item := range strings.Split(raw, ",") {
		key := strings.TrimSpace(item)
		if key == "" {
			continue
		}
		if !slices.Contains(Keys, key) {
			return Flags{}, fmt.Errorf("unknown feature %q in FEATURES_DISABLED, allowed: %s", key, strings.Join(Keys, ","))
		}
		disabled[key] = true
	}
	return Flags{disabled: disabled}, nil
}

func (f Flags) Enabled(key string) bool { return !f.disabled[key] }

// Map отдает состояние всех флагов для GET /features.
func (f Flags) Map() map[string]bool {
	out := make(map[string]bool, len(Keys))
	for _, key := range Keys {
		out[key] = f.Enabled(key)
	}
	return out
}

// ForAction возвращает флаг сценария для типа действия или пустую строку.
func ForAction(actionType string) string {
	switch actionType {
	case "absences.create_request":
		return Absences
	case "escalation.create":
		return Escalations
	default:
		return ""
	}
}
