// Package policy проверяет права по доверенным актуальным данным Go.
package policy

type Operation string

const (
	GetPlan      Operation = "checklist.get_plan"
	UpdateStatus Operation = "checklist.update_status"
	CreateChat   Operation = "chat.create"
	ReadChat     Operation = "chat.read"
)

type Actor struct{ ID, TeamID, Role string }
type Resource struct{ TeamID, OwnerID, BuddyID, AssigneeID string }

// Check возвращает пустую строку при разрешении или безопасный код причины отказа.
// Загрузка актуального пользователя и ресурса остается обязанностью вызывающего кода.
func Check(actor Actor, operation Operation, resource Resource) string {
	if actor.ID == "" || actor.TeamID == "" {
		return "invalid_actor"
	}
	if actor.Role != "intern" && actor.Role != "buddy" && actor.Role != "lead" {
		return "role_denied"
	}
	if resource.TeamID == "" || actor.TeamID != resource.TeamID {
		return "team_denied"
	}
	switch operation {
	case GetPlan, UpdateStatus:
		visible := actor.Role == "intern" && resource.OwnerID == actor.ID || actor.Role == "buddy" && resource.BuddyID == actor.ID || actor.Role == "lead"
		if !visible {
			return "owner_or_assignment_denied"
		}
		if operation == UpdateStatus && resource.AssigneeID != actor.ID {
			return "assignee_denied"
		}
	case CreateChat, ReadChat:
		if resource.OwnerID != actor.ID {
			return "owner_denied"
		}
	default:
		return "operation_denied"
	}
	return ""
}
