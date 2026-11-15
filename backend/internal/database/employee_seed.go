package database

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"unicode/utf8"

	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/employees"
	"github.com/ai-buddy-hc2026/ai-buddy/backend/internal/identifier"
	"github.com/jackc/pgx/v5"
)

type employeeSeedRow struct {
	ID            string   `json:"id"`
	TeamID        string   `json:"team_id"`
	UserID        *string  `json:"user_id"`
	DisplayName   string   `json:"display_name"`
	ShortName     string   `json:"short_name"`
	JobTitle      string   `json:"job_title"`
	Kind          string   `json:"kind"`
	Tags          []string `json:"tags"`
	AskAbout      string   `json:"ask_about"`
	ContactHandle *string  `json:"contact_handle"`
	IsKeyContact  bool     `json:"is_key_contact"`
	SortOrder     int      `json:"sort_order"`
	Active        *bool    `json:"active"`
}

func validEmployeeText(value string, max int) bool {
	return strings.TrimSpace(value) != "" && len([]rune(value)) <= max
}

func parseEmployeeSeed(data []byte) ([]employeeSeedRow, error) {
	if len(data) > 1<<20 || !utf8.Valid(data) {
		return nil, fmt.Errorf("invalid employee seed size or encoding")
	}
	var seed struct {
		Employees []employeeSeedRow `json:"employees"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&seed); err != nil {
		return nil, fmt.Errorf("decode employee seed: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("employee seed must contain one JSON object")
	}
	if seed.Employees == nil || len(seed.Employees) > 1000 {
		return nil, fmt.Errorf("employee seed requires an employees array of at most 1000 items")
	}
	seen := make(map[string]bool)
	for i := range seed.Employees {
		e := &seed.Employees[i]
		if !identifier.ValidUUID(e.ID) || !identifier.ValidUUID(e.TeamID) || seen[e.ID] ||
			(e.UserID != nil && (*e.UserID != e.ID || !identifier.ValidUUID(*e.UserID))) ||
			!validEmployeeText(e.DisplayName, 120) || !validEmployeeText(e.ShortName, 60) || !validEmployeeText(e.JobTitle, 160) ||
			len([]rune(e.AskAbout)) > 1000 || e.SortOrder < 0 || e.Active == nil || e.Tags == nil || len(e.Tags) > 12 ||
			(e.ContactHandle != nil && !validEmployeeText(*e.ContactHandle, 120)) {
			return nil, fmt.Errorf("invalid employee at index %d", i)
		}
		switch e.Kind {
		case "intern", "mentor", "lead", "hr", "colleague":
		default:
			return nil, fmt.Errorf("invalid employee kind at index %d", i)
		}
		seen[e.ID] = true
		tags := make(map[string]bool)
		for j, tag := range e.Tags {
			tag = employees.NormalizeSearch(tag)
			if !validEmployeeText(tag, 60) || tags[tag] {
				return nil, fmt.Errorf("invalid or duplicate employee tag at index %d", i)
			}
			e.Tags[j] = tag
			tags[tag] = true
		}
		e.DisplayName = strings.TrimSpace(e.DisplayName)
		e.ShortName = strings.TrimSpace(e.ShortName)
		e.JobTitle = strings.TrimSpace(e.JobTitle)
	}
	return seed.Employees, nil
}

func seedEmployees(ctx context.Context, tx pgx.Tx, files fs.FS) error {
	data, err := fs.ReadFile(files, "seeds/employees.json")
	if err != nil {
		return fmt.Errorf("read employee seed: %w", err)
	}
	items, err := parseEmployeeSeed(data)
	if err != nil {
		return err
	}
	for _, e := range items {
		_, err = tx.Exec(ctx, `INSERT INTO employees(id,team_id,user_id,display_name,short_name,job_title,kind,tags,ask_about,contact_handle,is_key_contact,sort_order,active)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`,
			e.ID, e.TeamID, e.UserID, e.DisplayName, e.ShortName, e.JobTitle, e.Kind, e.Tags, e.AskAbout, e.ContactHandle, e.IsKeyContact, e.SortOrder, *e.Active)
		if err != nil {
			return fmt.Errorf("seed employee %s: %w", e.ID, err)
		}
	}
	return nil
}
