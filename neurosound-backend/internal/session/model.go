package session

import (
	"time"

	"neurosound-backend/internal/analysis"
)

type Snapshot struct {
	TrialCount int         `json:"trial_count" bson:"trial_count"`
	ABRAverage [][]float64 `json:"abr_average" bson:"abr_average"`
	PearsonR   float64     `json:"pearson_r" bson:"pearson_r"`
}

type Document struct {
	Filename     string          `json:"filename" bson:"filename"`
	SavedAt      time.Time       `json:"saved_at" bson:"saved_at"`
	TrialCount   int             `json:"trial_count" bson:"trial_count"`
	SamplingRate int             `json:"sampling_rate" bson:"sampling_rate"`
	EpochMs      float64         `json:"epoch_ms" bson:"epoch_ms"`
	ABRAverage   [][]float64     `json:"abr_average" bson:"abr_average"`
	ABRSnapshots []Snapshot      `json:"abr_snapshots" bson:"abr_snapshots"`
	SNR          []float64       `json:"snr" bson:"snr"`
	PearsonR     float64         `json:"pearson_r" bson:"pearson_r"`
	Quality      string          `json:"quality" bson:"quality"`
	Status       string          `json:"status" bson:"status"`
	Analysis     analysis.Detail `json:"analysis" bson:"analysis"`
}

type Meta struct {
	Filename   string    `json:"filename" bson:"filename"`
	SavedAt    time.Time `json:"saved_at" bson:"saved_at"`
	TrialCount int       `json:"trial_count" bson:"trial_count"`
	Status     string    `json:"status" bson:"status"`
	SNR        []float64 `json:"snr" bson:"snr"`
	Verdict    string    `json:"verdict" bson:"verdict"`
}
