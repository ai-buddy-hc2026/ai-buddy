// Package toolcontract публикует исходные схемы MCP-профиля 1.1.
package toolcontract

import (
	"encoding/json"
	"fmt"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
)

type Definition struct{ Name, Input, Output, Description string }

var Definitions = []Definition{
	{"checklist.get_plan", "GetPlanInput", "GetPlanOutput", "Получить разрешенный план онбординга. Для buddy/lead укажи intern_id доступного стажера."},
	{"checklist.update_status", "UpdateStatusInput", "Failure", "Для изменения статуса сформируй action_proposal с этими аргументами. Прямой вызов не меняет данные и возвращает CONFIRMATION_REQUIRED."},
	{"employees.get_manager", "EmptyInput", "GetManagerOutput", "Получить своего наставника, а при его отсутствии своего руководителя."},
	{"absences.get_policy", "EmptyInput", "GetPolicyOutput", "Получить структурированные правила однодневного отсутствия своей команды."},
	{"absences.create_request", "CreateAbsenceInput", "Failure", "Для заявки сформируй action_proposal с этими аргументами. Прямой вызов не создает заявку и возвращает CONFIRMATION_REQUIRED."},
	{"absences.list_for_employee", "ListAbsencesInput", "ListAbsencesOutput", "Получить страницу заявок: назначенные стажеры для buddy, своя команда для lead."},
}

var schemas = sync.OnceValues(func() (map[string]*jsonschema.Resolved, error) {
	var bundle struct {
		Defs map[string]json.RawMessage `json:"$defs"`
	}
	if err := json.Unmarshal([]byte(schemaData), &bundle); err != nil {
		return nil, err
	}
	out := make(map[string]*jsonschema.Resolved)
	for name := range bundle.Defs {
		runtimeSchema := Schema(name).(map[string]any)
		// Go RE2 не поддерживает lookahead ECMA-262. not/const эквивалентен
		// запрету нулевого UUID; публикуемая исходная схема не меняется.
		uuid := runtimeSchema["$defs"].(map[string]any)["UUID"].(map[string]any)
		uuid["pattern"] = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
		uuid["not"] = map[string]any{"const": "00000000-0000-0000-0000-000000000000"}
		raw, _ := json.Marshal(runtimeSchema)
		var schema jsonschema.Schema
		if err := json.Unmarshal(raw, &schema); err != nil {
			return nil, err
		}
		resolved, err := schema.Resolve(nil)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", name, err)
		}
		out[name] = resolved
	}
	return out, nil
})

func Schema(name string) any {
	var bundle map[string]any
	if err := json.Unmarshal([]byte(schemaData), &bundle); err != nil {
		panic(err)
	}
	kind := "object"
	if definition, ok := bundle["$defs"].(map[string]any)[name].(map[string]any); ok {
		if value, ok := definition["type"].(string); ok {
			kind = value
		}
	}
	return map[string]any{"$schema": bundle["$schema"], "type": kind, "$ref": "#/$defs/" + name, "$defs": bundle["$defs"]}
}

func Validate(name string, value any) error {
	resolved, err := schemas()
	if err != nil {
		return err
	}
	schema, ok := resolved[name]
	if !ok {
		return fmt.Errorf("unknown schema %s", name)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var instance any
	if err := json.Unmarshal(raw, &instance); err != nil {
		return err
	}
	if err := schema.Validate(instance); err != nil {
		return err
	}
	root := Schema(name).(map[string]any)
	return validateFormats(root["$defs"].(map[string]any)[name].(map[string]any), instance, root["$defs"].(map[string]any))
}

func validateFormats(schema map[string]any, value any, defs map[string]any) error {
	if ref, ok := schema["$ref"].(string); ok {
		return validateFormats(defs[ref[len("#/$defs/"):]].(map[string]any), value, defs)
	}
	if text, ok := value.(string); ok {
		switch schema["format"] {
		case "uuid":
			if !identifier.ValidUUID(text) {
				return fmt.Errorf("invalid uuid")
			}
		case "date":
			if _, err := time.Parse(time.DateOnly, text); err != nil {
				return err
			}
		case "date-time":
			if _, err := time.Parse(time.RFC3339Nano, text); err != nil {
				return err
			}
		}
	}
	if object, ok := value.(map[string]any); ok {
		if properties, ok := schema["properties"].(map[string]any); ok {
			for name, definition := range properties {
				if item, ok := object[name]; ok {
					if err := validateFormats(definition.(map[string]any), item, defs); err != nil {
						return err
					}
				}
			}
		}
	}
	if items, ok := value.([]any); ok {
		if definition, ok := schema["items"].(map[string]any); ok {
			for _, item := range items {
				if err := validateFormats(definition, item, defs); err != nil {
					return err
				}
			}
		}
	}
	for _, key := range []string{"anyOf", "oneOf"} {
		if variants, ok := schema[key].([]any); ok {
			for _, variant := range variants {
				if err := validateFormats(variant.(map[string]any), value, defs); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func Input(name string) string {
	for _, d := range Definitions {
		if d.Name == name {
			return d.Input
		}
	}
	return ""
}
