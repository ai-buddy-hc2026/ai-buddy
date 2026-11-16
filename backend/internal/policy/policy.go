// Package policy проверяет права по доверенным актуальным данным Go.
package policy

type Operation string

const (
	GetPlan          Operation = "checklist.get_plan"
	UpdateStatus     Operation = "checklist.update_status"
	CreateChat       Operation = "chat.create"
	ReadChat         Operation = "chat.read"
	GetManager       Operation = "employees.get_manager"
	GetAbsencePolicy Operation = "absences.get_policy"
	ListAbsences     Operation = "absences.list_for_employee"
	CreateAbsence    Operation = "absences.create_request"
	CreateEscalation Operation = "escalation.create"
	AnswerEscalation Operation = "escalation.answer"
	SearchKnowledge  Operation = "knowledge.search"
	ListBuddyInterns Operation = "buddy.list_interns"
	ListActions      Operation = "actions.list"
	ListSlots        Operation = "calendar.list_slots"
	BookSlot         Operation = "calendar.book_slot"
	FindOwner        Operation = "employees.find_owner"
	RequestAccess    Operation = "access.request_access"
	FindPlace        Operation = "map.find_place"
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
	case CreateChat, ReadChat, GetManager, CreateAbsence, ListActions, BookSlot, RequestAccess:
		if resource.OwnerID != actor.ID {
			return "owner_denied"
		}
	case ListAbsences:
		if actor.Role == "intern" {
			return "role_denied"
		}
		if actor.Role == "buddy" && resource.BuddyID != actor.ID {
			return "assignment_denied"
		}
	case CreateEscalation:
		if actor.Role != "intern" {
			return "role_denied"
		}
		if resource.OwnerID != actor.ID {
			return "owner_denied"
		}
	case ListBuddyInterns:
		if actor.Role != "buddy" {
			return "role_denied"
		}
		if resource.BuddyID != actor.ID {
			return "assignment_denied"
		}
	case AnswerEscalation:
		if actor.Role != "buddy" || resource.BuddyID != actor.ID {
			return "assignment_denied"
		}
	case SearchKnowledge:
		if actor.Role != "intern" {
			return "role_denied"
		}
	// Справочные моки: команда уже проверена выше, данные чужих команд отсекает запрос.
	case GetAbsencePolicy, ListSlots, FindOwner, FindPlace:
	default:
		return "operation_denied"
	}
	return ""
}
