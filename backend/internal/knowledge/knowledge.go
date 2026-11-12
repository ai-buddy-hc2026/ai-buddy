package knowledge

import "errors"

var ErrInvalid = errors.New("invalid knowledge query")
var ErrDenied = errors.New("knowledge access denied")

type Source struct {
	DocumentID string `json:"document_id"`
	Revision   int    `json:"revision"`
	Title      string `json:"title"`
	Section    string `json:"section"`
	URL        string `json:"url"`
}

type Result struct {
	Source  Source `json:"source"`
	Content string `json:"content"`
}

type SearchResult struct {
	Items []Result `json:"items"`
}
