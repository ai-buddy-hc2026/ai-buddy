// Package growth хранит данные роста и сообщества стажёра: brag document,
// запросы обратной связи, события и интересы, треки, итоги встреч и random coffee.
package growth

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalid  = errors.New("invalid growth request")
	ErrNotFound = errors.New("growth object not found")
	ErrDenied   = errors.New("growth access denied")
	ErrConflict = errors.New("growth state conflict")
	ErrLimit    = errors.New("growth limit reached")
)

const (
	TitleMax          = 300
	LinkMax           = 2000
	QuestionMax       = 300
	AnswerMax         = 4000
	SummaryMax        = 4000
	AgreementMax      = 200
	AgreementsMax     = 20
	TagMax            = 40
	TagsMax           = 10
	MaxOpenPerPerson  = 3
	FeedbackLifetime  = 7 * 24 * time.Hour
	TracksMax         = 30
	TrackModulesMax   = 300
	tracksPayloadMax  = 64 << 10
	externalIDMax     = 200
	dateLayout        = "2006-01-02"
	meetingKeyPattern = `^[A-Za-z0-9_.:-]{1,100}$`
)

var meetingKey = regexp.MustCompile(meetingKeyPattern)

/* ---------- brag ---------- */

type BragItem struct {
	ID    string  `json:"id"`
	Kind  string  `json:"type"`
	Title string  `json:"title"`
	Link  *string `json:"link"`
	Date  string  `json:"date"`
}

type BragInput struct {
	Kind  string  `json:"type"`
	Title string  `json:"title"`
	Link  *string `json:"link"`
	Date  string  `json:"date"`
}

var bragKinds = []string{"task", "pr", "review", "feedback", "manual"}

func (in BragInput) Validate() error {
	if !slices.Contains(bragKinds, in.Kind) || !validText(in.Title, TitleMax) || !validDate(in.Date) {
		return ErrInvalid
	}
	if in.Link != nil && !validURL(*in.Link) {
		return ErrInvalid
	}
	return nil
}

/* ---------- feedback ---------- */

type FeedbackRequest struct {
	ID            string     `json:"id"`
	FromID        string     `json:"fromId"`
	ToID          string     `json:"toId"`
	ArtifactURL   string     `json:"artifactUrl"`
	ArtifactTitle string     `json:"artifactTitle"`
	Question      string     `json:"question"`
	Status        string     `json:"status"`
	Answer        *string    `json:"answer"`
	SentAt        time.Time  `json:"sentAt"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	AnsweredAt    *time.Time `json:"answeredAt"`
	SavedToBrag   bool       `json:"savedToBrag"`
	ExternalID    *string    `json:"externalId"`
}

type FeedbackInput struct {
	ToID          string  `json:"toId"`
	ArtifactURL   string  `json:"artifactUrl"`
	ArtifactTitle string  `json:"artifactTitle"`
	Question      string  `json:"question"`
	ExternalID    *string `json:"externalId"`
}

func (in FeedbackInput) Validate() error {
	if !validURL(in.ArtifactURL) || !validText(in.ArtifactTitle, TitleMax) || !validText(in.Question, QuestionMax) {
		return ErrInvalid
	}
	if in.ExternalID != nil && !validText(*in.ExternalID, externalIDMax) {
		return ErrInvalid
	}
	return nil
}

// FeedbackStatus: ответ важнее срока, просроченный без ответа запрос - expired.
func FeedbackStatus(answered bool, expiresAt, now time.Time) string {
	switch {
	case answered:
		return "answered"
	case !now.Before(expiresAt):
		return "expired"
	default:
		return "sent"
	}
}

/* ---------- events and interests ---------- */

type Event struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Start       time.Time `json:"start"`
	Minutes     int       `json:"minutes"`
	PlaceID     *string   `json:"placeId"`
	PlaceName   string    `json:"placeName"`
	HostID      string    `json:"hostId"`
	Tags        []string  `json:"tags"`
	Capacity    *int      `json:"capacity"`
	Attendees   []string  `json:"attendees"`
	Materials   []string  `json:"materials"`
}

type InterestGroup struct {
	Tag     string   `json:"tag"`
	Members []string `json:"members"`
}

type Interests struct {
	Tags   []string        `json:"tags"`
	Groups []InterestGroup `json:"groups"`
}

// NormalizeTags приводит теги к нижнему регистру, убирает # и повторы, сохраняя порядок.
func NormalizeTags(raw []string) ([]string, error) {
	tags := make([]string, 0, len(raw))
	for _, item := range raw {
		tag := strings.ToLower(strings.Join(strings.Fields(strings.TrimLeft(strings.TrimSpace(item), "#")), " "))
		if tag == "" || !utf8.ValidString(tag) || utf8.RuneCountInString(tag) > TagMax {
			return nil, ErrInvalid
		}
		if !slices.Contains(tags, tag) {
			tags = append(tags, tag)
		}
	}
	if len(tags) > TagsMax {
		return nil, ErrInvalid
	}
	return tags, nil
}

/* ---------- tracks ---------- */

// Tracks повторяет userTracksSchema фронта: выбранные треки и прогресс модулей.
type Tracks struct {
	Selected []string                   `json:"selected"`
	Modules  map[string]json.RawMessage `json:"modules"`
}

type moduleProgress struct {
	Status      string  `json:"status"`
	LastScore   *int    `json:"lastScore"`
	LastAttempt *string `json:"lastAttempt"`
}

var moduleStatuses = []string{"todo", "done", "skipped_by_test"}

func (t Tracks) Validate() error {
	if t.Selected == nil || t.Modules == nil || len(t.Selected) > TracksMax || len(t.Modules) > TrackModulesMax {
		return ErrInvalid
	}
	for i, id := range t.Selected {
		if !meetingKey.MatchString(id) || slices.Contains(t.Selected[:i], id) {
			return ErrInvalid
		}
	}
	for id, raw := range t.Modules {
		var progress moduleProgress
		if !meetingKey.MatchString(id) || json.Unmarshal(raw, &progress) != nil || !slices.Contains(moduleStatuses, progress.Status) {
			return ErrInvalid
		}
		if progress.LastScore != nil && (*progress.LastScore < 0 || *progress.LastScore > 100) {
			return ErrInvalid
		}
	}
	return nil
}

/* ---------- meetings ---------- */

type Agreement struct {
	ID      string  `json:"id"`
	Owner   string  `json:"owner"`
	What    string  `json:"what"`
	DueDate *string `json:"due_date"`
}

type MeetingDraft struct {
	Summary    string      `json:"summary"`
	Agreements []Agreement `json:"agreements"`
}

type MeetingRecord struct {
	MeetingID  string      `json:"meetingId"`
	Summary    string      `json:"summary"`
	Agreements []Agreement `json:"agreements"`
	SavedAt    time.Time   `json:"savedAt"`
	TaskCount  int         `json:"taskCount"`
}

var agreementOwners = []string{"intern", "mentor", "other"}

func ValidMeetingKey(key string) bool { return meetingKey.MatchString(key) }

func (d MeetingDraft) Validate() error {
	if !validText(d.Summary, SummaryMax) || d.Agreements == nil || len(d.Agreements) > AgreementsMax {
		return ErrInvalid
	}
	for _, a := range d.Agreements {
		if a.ID == "" || len(a.ID) > 100 || !slices.Contains(agreementOwners, a.Owner) || !validText(a.What, AgreementMax) {
			return ErrInvalid
		}
		if a.DueDate != nil && !validDate(*a.DueDate) {
			return ErrInvalid
		}
	}
	return nil
}

// NewTask - задача плана из договорённости встречи.
type NewTask struct {
	SeedKey     string
	Title       string
	Description string
	DueDate     *string
	ForMentor   bool
}

var ownerNotes = map[string]string{
	"intern": "Договорённость со встречи",
	"mentor": "Сделает наставник",
	"other":  "Проследить, что коллега сделал",
}

// AgreementTasks превращает договорённости в задачи. Ключ meeting:<key>:<id> делает
// повторное сохранение тех же итогов идемпотентным.
func AgreementTasks(key string, agreements []Agreement) []NewTask {
	tasks := make([]NewTask, 0, len(agreements))
	seen := make(map[string]bool, len(agreements))
	for _, a := range agreements {
		title := strings.TrimSpace(a.What)
		if seen[title] {
			continue
		}
		seen[title] = true
		tasks = append(tasks, NewTask{
			SeedKey:     "meeting:" + key + ":" + a.ID,
			Title:       title,
			Description: ownerNotes[a.Owner] + " (источник: meeting:" + key + ")",
			DueDate:     a.DueDate,
			ForMentor:   a.Owner == "mentor",
		})
	}
	return tasks
}

/* ---------- coffee ---------- */

type CoffeePair struct {
	ID        string `json:"id"`
	WeekStart string `json:"weekStart"`
	PartnerID string `json:"partnerId"`
	Status    string `json:"status"`
}

// Pair - пара на неделю, A < B, как требует таблица coffee_pairs.
type Pair struct{ A, B string }

func orderedPair(a, b string) Pair {
	if a > b {
		a, b = b, a
	}
	return Pair{A: a, B: b}
}

// PlanPairs детерминированно делит участников на пары, избегая повторов с прошлой недели.
// При нечётном числе один участник остаётся без пары. Ввод не меняется.
func PlanPairs(users []string, previous []Pair) []Pair {
	pool := slices.Clone(users)
	slices.Sort(pool)
	pool = slices.Compact(pool)
	met := make(map[Pair]bool, len(previous))
	for _, p := range previous {
		met[orderedPair(p.A, p.B)] = true
	}
	used := make(map[string]bool, len(pool))
	pairs := make([]Pair, 0, len(pool)/2)
	for i, a := range pool {
		if used[a] {
			continue
		}
		fallback := ""
		partner := ""
		for _, b := range pool[i+1:] {
			if used[b] {
				continue
			}
			if fallback == "" {
				fallback = b
			}
			if !met[orderedPair(a, b)] {
				partner = b
				break
			}
		}
		if partner == "" {
			partner = fallback
		}
		if partner == "" {
			continue
		}
		used[a], used[partner] = true, true
		pairs = append(pairs, orderedPair(a, partner))
	}
	return pairs
}

/* ---------- helpers ---------- */

func validText(value string, max int) bool {
	return utf8.ValidString(value) && strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max
}

func validDate(value string) bool {
	_, err := time.Parse(dateLayout, value)
	return err == nil
}

func validURL(value string) bool {
	return len(value) <= LinkMax && (strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://")) &&
		len(value) > len("https://") && !strings.ContainsAny(value, " \t\r\n")
}
